import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.GENERATION_QUEUE_LIFECYCLE_SCHEMA_TEST === "1";

describe("generation queue lifecycle migration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("preserves timed_out and all existing statuses with neutral lifecycle defaults", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const userId = randomUUID();
    const statuses = ["queued", "running", "done", "error", "timed_out"];

    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const databaseName = database.rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
        throw new Error(`refusing generation lifecycle test against non-disposable database '${databaseName}'`);
      }
      await client.query("begin");
      await client.query("insert into users(id, username) values ($1, $2)", [userId, `generation-lifecycle-${userId}`]);
      for (const status of statuses) {
        await client.query(
          `insert into generations(user_id, branch, prompt, status)
           values ($1, 'openscad', $2, $3)`,
          [userId, status, status],
        );
      }
      const rows = await client.query<{
        status: string;
        leased_by: string | null;
        lease_generation: string;
        attempts: number;
        lease_expires_at: Date | null;
      }>(
        `select status, leased_by, lease_generation::text, attempts, lease_expires_at
           from generations where user_id=$1
          order by array_position(array['queued','running','done','error','timed_out'], status)`,
        [userId],
      );
      expect(rows.rows).toEqual(
        statuses.map((status) => ({
          status,
          leased_by: null,
          lease_generation: "0",
          attempts: 0,
          lease_expires_at: null,
        })),
      );
      const indexes = await client.query<{ indexname: string }>(
        `select indexname from pg_indexes
          where schemaname='public' and indexname=any($1::text[]) order by indexname`,
        [["generations_queue_claim_idx", "generations_queue_expiry_idx"]],
      );
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(["generations_queue_claim_idx", "generations_queue_expiry_idx"]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
