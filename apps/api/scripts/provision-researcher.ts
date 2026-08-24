// MF-1574: безопасное провижининг service account для исследовательского API.
// Секрет приходит только через окружение и никогда не печатается/не сохраняется в репозитории.
// Перед запуском на целевой БД миграции должны быть применены обычным dbmate deploy-контуром.

import { createHash } from "node:crypto";
import { pool } from "../src/db/client.ts";
import { RESEARCH_API_KEY_PREFIX } from "../src/modules/publicapi/public/operations.ts";
import { assertExplicitOperationalTarget } from "./dev-seed-guard.ts";

const USERNAME = "researcher-creality";
const DISPLAY_NAME = "Researcher Creality";

function requiredSecret(): string {
  const secret = process.env.RESEARCHER_API_KEY?.trim();
  if (!secret || !secret.startsWith(RESEARCH_API_KEY_PREFIX) || secret.length <= RESEARCH_API_KEY_PREFIX.length) {
    throw new Error(`RESEARCHER_API_KEY должен начинаться с ${RESEARCH_API_KEY_PREFIX} и быть задан только через окружение`);
  }
  return secret;
}

function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

async function run(): Promise<void> {
  const secret = requiredSecret();
  await assertExplicitOperationalTarget(pool, "provision researcher", "PROVISION_RESEARCHER_DB_NAME");
  const keyPrefix = secret.slice(0, RESEARCH_API_KEY_PREFIX.length + 8);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existing = await client.query<{ id: string; role: string; status: string }>(`select id, role, status from users where username = $1 for update`, [USERNAME]);

    let userId: string;
    if (existing.rows[0]) {
      if (existing.rows[0].role !== "researcher") {
        throw new Error(`учётная запись ${USERNAME} уже существует с ролью ${existing.rows[0].role}; возвышение запрещено`);
      }
      userId = existing.rows[0].id;
      await client.query(`update users set status = 'active', updated_at = now() where id = $1`, [userId]);
    } else {
      const created = await client.query<{ id: string }>(
        `insert into users (username, display_name, status, handle_confirmed, role)
         values ($1, $2, 'active', true, 'researcher') returning id`,
        [USERNAME, DISPLAY_NAME],
      );
      userId = created.rows[0]!.id;
    }

    await client.query(
      `insert into user_api_keys (
         user_id, scope, scopes, label, key_prefix, key_hash, status, revoked_at, revoked_reason, expires_at, updated_at
       ) values ($1, 'research', array['write']::text[], $2, $3, $4, 'active', null, null, null, now())
       on conflict (user_id) where scope = 'research' do update set
         scopes = excluded.scopes,
         label = excluded.label,
         key_prefix = excluded.key_prefix,
         key_hash = excluded.key_hash,
         status = 'active',
         revoked_at = null,
         revoked_reason = null,
         expires_at = null,
         updated_at = now()`,
      [userId, "${USERNAME} POST /research/printers", keyPrefix, hashSecret(secret)],
    );

    await client.query("commit");
    console.log(`provision researcher: account=${USERNAME} role=researcher scope=research permission=write key_prefix=${keyPrefix}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

run()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : "provision researcher failed");
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
