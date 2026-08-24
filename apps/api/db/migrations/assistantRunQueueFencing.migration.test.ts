import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.ASSISTANT_QUEUE_FENCING_SCHEMA_TEST === "1";

describe("assistant run queue fencing migration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("reuses attempts and lease while adding neutral owner/generation defaults", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const databaseName = database.rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
        throw new Error(`refusing assistant fencing test against non-disposable database '${databaseName}'`);
      }
      const columns = await client.query<{
        column_name: string;
        column_default: string | null;
      }>(
        `select column_name,column_default from information_schema.columns
          where table_schema='public' and table_name='assistant_runs'
            and column_name=any($1::text[]) order by column_name`,
        [["attempts", "lease_expires_at", "lease_generation", "leased_by"]],
      );
      expect(columns.rows.map(({ column_name }) => column_name)).toEqual(["attempts", "lease_expires_at", "lease_generation", "leased_by"]);
      expect(columns.rows.find(({ column_name }) => column_name === "attempts")?.column_default).toContain("0");
      expect(columns.rows.find(({ column_name }) => column_name === "lease_generation")?.column_default).toContain("0");
      const indexes = await client.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname='public'
          and indexname=any($1::text[]) order by indexname`,
        [["assistant_runs_queue_claim_idx", "assistant_runs_queue_expiry_idx"]],
      );
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(["assistant_runs_queue_claim_idx", "assistant_runs_queue_expiry_idx"]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
