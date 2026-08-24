import { randomBytes } from "node:crypto";
import { pool } from "../../../db/client.ts";

// Подтверждение владения источником (эпик MF-37 § 6, схема — 20260710010000_import_pipeline_
// foundation.sql). Два режима, одна колонка `ownership_status` на import_connections + денорм-
// копия на import_bindings (публикационный гейт в models/mutate.ts читает один джойн):
//  1. API-ключевые коннекторы (Cults3D) — сам факт валидной авторизации доказывает владение,
//     коннектор зовёт markConnectionVerifiedByAuth() сразу после первого успешного запроса.
//  2. Challenge-строка для источников без OAuth/ключа — requestChallenge()/confirmChallenge()
//     ниже, нейтральны к источнику: КАК прочитать bio/описание модели — дело коннектора,
//     здесь только генерация токена и сверка присланного текста.

export class NotFoundError extends Error {}
export class NoActiveChallengeError extends Error {}

export interface ImportConnectionRow {
  id: string;
  source_platform: string;
  external_username: string | null;
  ownership_status: string;
  challenge_token: string | null;
  challenge_target: string | null;
  status: string;
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface ImportBindingSummary {
  id: string;
  model_id: string;
  source_platform: string;
  external_id: string;
  ownership_status: string;
  imported_at: string;
}

async function requireOwnConnection(userId: string, connectionId: string): Promise<{ id: string; challenge_token: string | null } | null> {
  const result = await pool.query<{ id: string; challenge_token: string | null }>(`select id, challenge_token from import_connections where id = $1 and user_id = $2`, [
    connectionId,
    userId,
  ]);
  return result.rows[0] ?? null;
}

// Готово-когда шага 4 MF-417: import_connections.ownership_status и денорм-копия на
// import_bindings меняются в ОДНОЙ транзакции (конвенция репо — консистентность на api-слое,
// не триггером). connection_id → import_bindings — все привязки этого коннектора получают
// новый статус разом (один аккаунт-источник может стоять за несколькими импортированными
// моделями).
async function setOwnershipStatus(connectionId: string, status: "verified" | "rejected"): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update import_connections set
         ownership_status = $2,
         verified_at = case when $2 = 'verified' then now() else verified_at end,
         challenge_token = null,
         challenge_target = null,
         updated_at = now()
       where id = $1`,
      [connectionId, status],
    );
    await client.query(`update import_bindings set ownership_status = $2, updated_at = now() where connection_id = $1`, [connectionId, status]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// Режим 1 (эпик MF-37 § 6): вызывается коннектором сразу после первого успешного запроса к
// API источника (ключ на cults3d.com/en/api/keys выпускает только владелец аккаунта — сам факт
// валидной авторизации уже доказывает владение, отдельный challenge не нужен). Идемпотентно —
// повторный вызов на уже verified просто переподтверждает.
export async function markConnectionVerifiedByAuth(connectionId: string): Promise<void> {
  await setOwnershipStatus(connectionId, "verified");
}

// Режим 2: генерирует challenge-строку и переводит коннектор в 'pending'. `target` — куда
// автору предложено вставить строку (bio профиля / описание конкретной модели на источнике) —
// текст решает коннектор/фронт, здесь только хранится для показа в ЛК.
export async function requestChallenge(userId: string, connectionId: string, target: string): Promise<{ token: string }> {
  const conn = await requireOwnConnection(userId, connectionId);
  if (!conn) throw new NotFoundError();

  const token = `3mf-verify-${randomBytes(9).toString("base64url")}`;
  await pool.query(
    `update import_connections set
       challenge_token = $2, challenge_target = $3, ownership_status = 'pending', updated_at = now()
     where id = $1`,
    [connectionId, token, target],
  );
  return { token };
}

// Валидация challenge — нейтральна к источнику: принимает уже прочитанный коннектором текст
// (bio/описание), сама решает verified/rejected по вхождению токена. КАК коннектор добыл этот
// текст (live-запрос к источнику, парсинг HTML) — вне этой функции, она отвечает только за
// решение по уже прочитанному содержимому.
export async function confirmChallenge(userId: string, connectionId: string, observedText: string): Promise<"verified" | "rejected"> {
  const conn = await requireOwnConnection(userId, connectionId);
  if (!conn) throw new NotFoundError();
  if (!conn.challenge_token) throw new NoActiveChallengeError();

  const verified = observedText.includes(conn.challenge_token);
  await setOwnershipStatus(connectionId, verified ? "verified" : "rejected");
  return verified ? "verified" : "rejected";
}

// GET-контракт для ЛК (MF-15): статус коннекторов + привязанных импортированных моделей.
export async function listConnectionsWithBindings(userId: string): Promise<{ connections: ImportConnectionRow[]; bindings: ImportBindingSummary[] }> {
  const connections = await pool.query<ImportConnectionRow>(
    `select id, source_platform, external_username, ownership_status, challenge_token, challenge_target,
            status, last_error, last_synced_at, created_at
     from import_connections where user_id = $1 order by created_at desc`,
    [userId],
  );
  const bindings = await pool.query<ImportBindingSummary>(
    `select id, model_id, source_platform, external_id, ownership_status, imported_at
     from import_bindings where user_id = $1 order by imported_at desc`,
    [userId],
  );
  return { connections: connections.rows, bindings: bindings.rows };
}

// Публикационный гейт (models/mutate.ts): одним запросом по model_id, без второго джойна до
// import_connections (import_bindings.ownership_status уже денормализован). null = модель не
// импортирована — publish не блокируется.
export async function importOwnershipStatusForModel(modelId: string): Promise<string | null> {
  const result = await pool.query<{ ownership_status: string }>(
    `select ib.ownership_status
       from import_bindings ib join models m on m.id = ib.model_id
      where m.project_id = $1`,
    [modelId],
  );
  return result.rows[0]?.ownership_status ?? null;
}
