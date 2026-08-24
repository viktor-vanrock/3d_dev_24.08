import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.DEVICE_COMMAND_RELAY_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260811170000_device_command_relay_lifecycle.sql", import.meta.url));

function migrationSections(sql: string): { up: string; down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("device command migration must contain up and down sections");
  const up = upSection.replace("-- migrate:up", "").trim();
  return { up, down: down.trim() };
}

describe("device command relay lifecycle migration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("maps legacy rows, exposes the target snapshot and rolls back to the legacy contract", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = migrationSections(await readFile(migrationPath, "utf8"));
    const userId = randomUUID();
    const deviceId = randomUUID();
    const ackedId = randomUUID();
    const rejectedId = randomUUID();

    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const databaseName = database.rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
        throw new Error(`refusing device command migration test against non-disposable database '${databaseName}'`);
      }

      await client.query("begin");
      await client.query(down);
      await client.query("insert into users(id,username) values($1,$2)", [userId, `relay-migration-${userId}`]);
      await client.query("insert into user_printers(id,user_id,brand,model,link_source) values($1,$2,'Test','Relay migration','manual')", [deviceId, userId]);
      await client.query(
        `insert into device_commands(id,device_id,command,status,command_seq)
         values ($1,$3,'pause','acked',1),($2,$3,'cancel','rejected',2)`,
        [ackedId, rejectedId, deviceId],
      );

      await client.query(up);
      const mapped = await client.query<{
        id: string;
        status: string;
        generation: string;
        attempt_count: number;
        max_attempts: number;
        lease_timeout_seconds: number;
        transition_at: Date | null;
        terminal_error_code: string | null;
      }>(
        `select id,status,generation::text,attempt_count,max_attempts,lease_timeout_seconds,
                coalesce(acknowledged_at,failed_at) as transition_at,terminal_error_code
           from device_commands where id=any($1::uuid[]) order by command_seq`,
        [[ackedId, rejectedId]],
      );
      expect(mapped.rows.map(({ id: _id, transition_at, ...row }) => ({ ...row, has_transition: transition_at instanceof Date }))).toEqual([
        { status: "acknowledged", generation: "0", attempt_count: 0, max_attempts: 3, lease_timeout_seconds: 30, terminal_error_code: null, has_transition: true },
        { status: "failed", generation: "0", attempt_count: 0, max_attempts: 3, lease_timeout_seconds: 30, terminal_error_code: "legacy_rejected", has_transition: true },
      ]);

      const columns = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name='device_commands'
            and column_name=any($1::text[]) order by column_name`,
        [
          [
            "claim_owner",
            "claim_token",
            "generation",
            "lease_expires_at",
            "attempt_count",
            "max_attempts",
            "lease_timeout_seconds",
            "expires_at",
            "terminal_error_code",
            "leased_at",
            "delivered_at",
            "acknowledged_at",
            "executed_at",
            "failed_at",
            "expired_at",
          ],
        ],
      );
      expect(columns.rows).toHaveLength(15);
      const indexes = await client.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname='public' and indexname=any($1::text[]) order by indexname`, [
        ["device_commands_relay_claim_idx", "device_commands_relay_lease_expiry_idx"],
      ]);
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(["device_commands_relay_claim_idx", "device_commands_relay_lease_expiry_idx"]);

      await client.query(down);
      const rolledBack = await client.query<{ status: string }>("select status from device_commands where id=any($1::uuid[]) order by command_seq", [[ackedId, rejectedId]]);
      expect(rolledBack.rows.map(({ status }) => status)).toEqual(["acked", "rejected"]);
      const removed = await client.query<{ count: string }>(
        `select count(*)::text as count from information_schema.columns
          where table_schema='public' and table_name='device_commands'
            and column_name=any($1::text[])`,
        [["claim_owner", "claim_token", "generation", "lease_expires_at", "attempt_count", "max_attempts", "lease_timeout_seconds", "expires_at", "terminal_error_code"]],
      );
      expect(removed.rows[0]?.count).toBe("0");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
