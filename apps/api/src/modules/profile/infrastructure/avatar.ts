import { createHash } from "node:crypto";
import { pool } from "../../../db/client.ts";

// Персонаж-аватар «мейкер-маскот» (MF-449, Фаза 2 эпика MF-446): персист конфига в профиль +
// решение открытого вопроса «случайная генерация для новых юзеров» (см. миграцию
// 20260710170000_user_avatar.sql). Списки id по слоям и
// форма AvatarConfig держатся синхронно с apps/web/src/home/avatar.tsx (PLASTICS/TEXTURES/
// POSES/OUTFITS/HATS/EYES/BEARDS/ARMS/ACCESSORIES/BACKS).
//
// Рандом — на сервере, не на клиенте: два устройства одного нового юзера должны увидеть
// ОДИН и тот же персонаж с первого входа, а не разный на каждом (гонка клиентских Math.random()).

const PLASTICS = ["mint", "coral", "amber", "sky", "lilac", "royal", "aqua", "graphite", "snow"] as const;
const TEXTURES = ["layers", "gloss", "matte", "rough", "marble", "carbon"] as const;
const POSES = ["stand", "wave", "cheer", "think", "present", "idea"] as const;
const OUTFITS = ["none", "sweater", "overall", "apron", "labcoat", "techvest"] as const;
const HATS = ["none", "helmet", "cap", "crown", "cat", "fox", "beanie"] as const;
const EYES = ["dots", "happy", "wink", "visor", "sleepy", "stars"] as const;
const BEARDS = ["none", "stubble", "moustache", "full", "braid"] as const;
const ARMS = ["plain", "gloves", "sleeves", "robot"] as const;
const ACCESSORIES = ["none", "spatula", "wrench", "heart", "caliper", "solder"] as const;
const BACKS = ["none", "spool", "jetpack"] as const;

export interface AvatarConfig {
  color: string;
  texture: string;
  pose: string;
  outfit: string;
  hat: string;
  eyes: string;
  beard: string;
  arms: string;
  accessory: string;
  back: string;
}

// Экспортится для achievements/wardrobe.ts (MF-1028): единый источник id по слоям для расчёта
// wardrobe-дефолтов, дублировать список здесь и там означало бы вторую точку рассинхрона с
// apps/web/src/home/avatar.tsx поверх уже существующей (см. комментарий в шапке файла).
export const LAYERS: Record<keyof AvatarConfig, readonly string[]> = {
  color: PLASTICS,
  texture: TEXTURES,
  pose: POSES,
  outfit: OUTFITS,
  hat: HATS,
  eyes: EYES,
  beard: BEARDS,
  arms: ARMS,
  accessory: ACCESSORIES,
  back: BACKS,
};

// Канонический маскот должен существовать и у legacy-юзера, который никогда не открывал
// редактор. Выбор детерминирован user_id: повторная materialize после удаления строки не
// «перебрасывает кости», два API-процесса получают тот же config без общего random state.
export function deterministicAvatarConfig(userId: string): AvatarConfig {
  const digest = createHash("sha256").update(userId).digest();
  const pick = (list: readonly string[], byte: number) => list[digest[byte]! % list.length]!;
  return {
    color: pick(PLASTICS, 0),
    texture: pick(TEXTURES, 1),
    pose: pick(POSES, 2),
    outfit: pick(OUTFITS, 3),
    hat: pick(HATS, 4),
    eyes: pick(EYES, 5),
    beard: pick(BEARDS, 6),
    arms: pick(ARMS, 7),
    accessory: pick(ACCESSORIES, 8),
    back: pick(BACKS, 9),
  };
}

function normalizeAvatarConfig(config: Partial<AvatarConfig> | null | undefined, userId: string): AvatarConfig {
  const fallback = deterministicAvatarConfig(userId);
  const normalized = {} as AvatarConfig;
  for (const key of Object.keys(LAYERS) as (keyof AvatarConfig)[]) {
    const value = config?.[key];
    normalized[key] = typeof value === "string" && LAYERS[key].includes(value) ? value : fallback[key];
  }
  return normalized;
}

// Снапшоты персонажа left/right/front (MF-1030, Фаза 3b MF-1020): PNG-рендеры канваса,
// раньше жившие только в localStorage клиента. Отдаём тем же приёмом, что фото-аватарка
// (avatarphoto.ts::avatarPhotoUrl) — постоянный прокси-путь, не голый S3-ключ, чтобы offload
// вкл/выкл решался на отдаче (registerAvatar), а не в момент записи URL в ответ.
export const AVATAR_SNAPSHOT_SIDES = ["left", "right", "front"] as const;
export type AvatarSnapshotSide = (typeof AVATAR_SNAPSHOT_SIDES)[number];

export interface AvatarSnapshots {
  left: string | null;
  right: string | null;
  front: string | null;
}

export function avatarSnapshotUrl(userId: string, revision: number, side: AvatarSnapshotSide, sha256: string): string {
  return `/avatars/${userId}/snapshots/${revision}/${side}/${sha256}.png`;
}

interface UserAvatarRow {
  config: AvatarConfig;
  revision: string | number;
  snapshot_left_s3_key: string | null;
  snapshot_right_s3_key: string | null;
  snapshot_front_s3_key: string | null;
  snapshot_left_sha256: string | null;
  snapshot_right_sha256: string | null;
  snapshot_front_sha256: string | null;
}

function snapshotsFromRow(userId: string, row: UserAvatarRow): AvatarSnapshots {
  const revision = Number(row.revision);
  return {
    left: row.snapshot_left_s3_key && row.snapshot_left_sha256 ? avatarSnapshotUrl(userId, revision, "left", row.snapshot_left_sha256) : null,
    right: row.snapshot_right_s3_key && row.snapshot_right_sha256 ? avatarSnapshotUrl(userId, revision, "right", row.snapshot_right_sha256) : null,
    front: row.snapshot_front_s3_key && row.snapshot_front_sha256 ? avatarSnapshotUrl(userId, revision, "front", row.snapshot_front_sha256) : null,
  };
}

export interface AvatarRef {
  avatar_config: AvatarConfig | null;
  avatar_snapshots: AvatarSnapshots | null;
}

const AVATAR_ROW_SELECT = `
  user_id, config, revision,
  snapshot_left_s3_key, snapshot_right_s3_key, snapshot_front_s3_key,
  snapshot_left_sha256, snapshot_right_sha256, snapshot_front_sha256
`;

async function materializeAvatarRows(userIds: string[]): Promise<Map<string, UserAvatarRow>> {
  const uniqueIds = [...new Set(userIds)];
  const result = new Map<string, UserAvatarRow>();
  if (uniqueIds.length === 0) return result;

  // Горячий путь чтения не делает бессмысленный INSERT ... ON CONFLICT на каждый feed request.
  const existing = await pool.query<UserAvatarRow & { user_id: string }>(
    `select ${AVATAR_ROW_SELECT}
     from user_avatar
     where user_id = any($1::uuid[])
       and exists (select 1 from users where users.id = user_avatar.user_id and users.status = 'active')`,
    [uniqueIds],
  );
  for (const row of existing.rows) {
    result.set(row.user_id, { ...row, config: normalizeAvatarConfig(row.config, row.user_id) });
  }

  const missingIds = uniqueIds.filter((id) => !result.has(id));
  if (missingIds.length === 0) return result;

  // Фильтр active одновременно не даёт случайному/устаревшему UUID уронить batch по FK и не
  // материализует публичную идентичность забаненному юзеру.
  const users = await pool.query<{ id: string }>(`select id from users where id = any($1::uuid[]) and status = 'active'`, [missingIds]);
  if (users.rows.length === 0) return result;

  const values: unknown[] = [];
  const tuples = users.rows.map((row) => {
    values.push(row.id, JSON.stringify(deterministicAvatarConfig(row.id)));
    return `($${values.length - 1}, $${values.length}::jsonb)`;
  });
  await pool.query(
    `insert into user_avatar (user_id, config)
     values ${tuples.join(", ")}
     on conflict (user_id) do nothing`,
    values,
  );

  const materialized = await pool.query<UserAvatarRow & { user_id: string }>(`select ${AVATAR_ROW_SELECT} from user_avatar where user_id = any($1::uuid[])`, [
    users.rows.map((row) => row.id),
  ]);
  for (const row of materialized.rows) {
    result.set(row.user_id, { ...row, config: normalizeAvatarConfig(row.config, row.user_id) });
  }
  return result;
}

// Батч-обогатитель канонической mascot-only идентичности. Legacy-юзер без user_avatar
// материализуется детерминированно, поэтому активный автор больше не падает на фото/инициал
// только из-за того, что ни разу не открывал редактор.
export async function avatarRefsByUserId(userIds: string[]): Promise<Map<string, AvatarRef>> {
  const result = new Map<string, AvatarRef>();
  if (userIds.length === 0) return result;

  const rows = await materializeAvatarRows(userIds);
  for (const [userId, row] of rows) {
    result.set(userId, { avatar_config: row.config, avatar_snapshots: snapshotsFromRow(userId, row) });
  }
  return result;
}
