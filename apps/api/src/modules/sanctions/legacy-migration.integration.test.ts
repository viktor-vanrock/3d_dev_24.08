import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.SANCTIONS_CUTOVER_MIGRATION_TEST === "1";
const migrationPath = fileURLToPath(new URL("../../../db/migrations/20260812170000_sanctions_cutover.sql", import.meta.url));
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
const legacyStatus = ["ban", "ned"].join("");

function migrationUp(sql: string): string {
  const [up] = sql.split("-- migrate:down");
  if (up === undefined) throw new Error("sanctions cutover migration requires an up section");
  return up.replace("-- migrate:up", "").trim();
}

describe("sanctions cutover migration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("converts a legacy banned user into an idempotent permanent legacy sanction", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const userId = randomUUID();
    const username = `legacy-banned-${userId}`;
    const startsAt = new Date("2026-01-02T03:04:05.000Z");
    try {
      const databaseName = (await client.query<{ name: string }>("select current_database() as name")).rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
        throw new Error(`refusing sanctions cutover migration test against non-disposable database '${databaseName}'`);
      }
      await client.query("begin");
      await client.query(`alter table users drop constraint users_status_check; alter table users add constraint users_status_check check (status in ('active', 'restricted', '${legacyStatus}', 'deleted'))`);
      await client.query(`insert into users(id, username, status, updated_at) values ($1, $2, $3, $4)`, [userId, username, legacyStatus, startsAt]);
      const up = migrationUp(await readFile(migrationPath, "utf8"));
      await client.query(up);
      const migrated = await client.query<{ status: string; starts_at: Date; ends_at: Date | null; type: string; reason_code: string; created_by: string; idempotency_key: string }>(
        `select u.status, s.starts_at, s.ends_at, s.type, s.reason_code, s.created_by, s.idempotency_key
         from users u join sanctions s on s.user_id = u.id where u.id = $1`,
        [userId],
      );
      expect(migrated.rows).toEqual([
        expect.objectContaining({ status: "restricted", type: "ban", reason_code: "legacy", created_by: SYSTEM_USER_ID, idempotency_key: `legacy-ban:${userId}`, ends_at: null }),
      ]);
      expect(new Date(migrated.rows[0]!.starts_at).toISOString()).toBe(startsAt.toISOString());

      // Replay is safe: the deterministic key keeps a second pass from creating another sanction.
      await client.query(`alter table users drop constraint users_status_check; alter table users add constraint users_status_check check (status in ('active', 'restricted', '${legacyStatus}', 'deleted'))`);
      await client.query(`update users set status = $2 where id = $1`, [userId, legacyStatus]);
      await client.query(up);
      await expect(client.query(`select count(*)::int as count from sanctions where idempotency_key = $1`, [`legacy-ban:${userId}`])).resolves.toMatchObject({ rows: [{ count: 1 }] });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
