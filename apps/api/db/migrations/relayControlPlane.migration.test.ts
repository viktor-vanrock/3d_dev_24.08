import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.RELAY_CONTROL_PLANE_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260811180000_relay_control_plane.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [rawUp, rawDown] = sql.split("-- migrate:down");
  if (rawUp === undefined || rawDown === undefined) throw new Error("relay control-plane migration requires up/down sections");
  return { up: rawUp.replace("-- migrate:up", "").trim(), down: rawDown.trim() };
}

describe("relay control-plane migration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("round-trips gateway/session/idempotency and immutable transfer authority", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const migration = sections(await readFile(migrationPath, "utf8"));
    try {
      const databaseName = (await client.query<{ name: string }>("select current_database() as name")).rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
        throw new Error(`refusing relay control-plane migration test against non-disposable database '${databaseName}'`);
      }
      await client.query("begin");
      await client.query(migration.down);
      expect(
        Number(
          (await client.query<{ count: string }>("select count(*)::text as count from information_schema.tables where table_schema='public' and table_name like 'relay_%'")).rows[0]
            ?.count,
        ),
      ).toBe(0);

      await client.query(migration.up);
      const tables = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema='public' and table_name=any($1::text[]) order by table_name",
        [["relay_gateway_sessions", "relay_internal_operations"]],
      );
      expect(tables.rows.map(({ table_name }) => table_name)).toEqual(["relay_gateway_sessions", "relay_internal_operations"]);
      const agentColumns = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='public' and table_name='agents' and column_name=any($1::text[]) order by column_name",
        [["authorization_revision", "relay_certificate_fingerprint_sha256"]],
      );
      expect(agentColumns.rows.map(({ column_name }) => column_name)).toEqual(["authorization_revision", "relay_certificate_fingerprint_sha256"]);
      const transferColumns = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='public' and table_name='device_transfers' and column_name=any($1::text[]) order by column_name",
        [["content_type", "object_key", "object_version", "source_ready_at"]],
      );
      expect(transferColumns.rows.map(({ column_name }) => column_name)).toEqual(["content_type", "object_key", "object_version", "source_ready_at"]);

      const ownerId = randomUUID();
      const gatewayId = randomUUID();
      await client.query(`insert into users(id,username) values($1,$2)`, [ownerId, `relay-owner-${ownerId}`]);
      await client.query(`insert into agents(id,owner_id) values($1,$2)`, [gatewayId, ownerId]);
      await client.query(`insert into user_printers(user_id,brand,model,link_source,agent_id,connection_mode) values($1,'Test','Relay','agent',$2,'managed-bridge')`, [
        ownerId,
        gatewayId,
      ]);
      expect((await client.query<{ revision: string }>(`select authorization_revision::text as revision from agents where id=$1`, [gatewayId])).rows[0]?.revision).toBe("1");
      await client.query(`update agents set revoked_at=now(),revoked_reason='test' where id=$1`, [gatewayId]);
      expect((await client.query<{ revision: string }>(`select authorization_revision::text as revision from agents where id=$1`, [gatewayId])).rows[0]?.revision).toBe("2");

      await client.query(migration.down);
      expect(
        Number(
          (await client.query<{ count: string }>("select count(*)::text as count from information_schema.tables where table_schema='public' and table_name like 'relay_%'")).rows[0]
            ?.count,
        ),
      ).toBe(0);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
