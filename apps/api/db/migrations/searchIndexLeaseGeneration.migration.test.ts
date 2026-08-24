import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.SEARCH_LEASE_GENERATION_SCHEMA_TEST === "1";

describe("search index acquisition generation migration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("keeps content generation separate from neutral lease generation", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const databaseName = database.rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
        throw new Error(`refusing search lease test against non-disposable database '${databaseName}'`);
      }
      const columns = await client.query<{
        column_name: string;
        column_default: string | null;
      }>(
        `select column_name,column_default from information_schema.columns
          where table_schema='public' and table_name='search_index_jobs'
            and column_name=any($1::text[]) order by column_name`,
        [["generation", "lease_generation"]],
      );
      expect(columns.rows.map(({ column_name }) => column_name)).toEqual(["generation", "lease_generation"]);
      expect(columns.rows.find(({ column_name }) => column_name === "generation")?.column_default).toContain("1");
      expect(columns.rows.find(({ column_name }) => column_name === "lease_generation")?.column_default).toContain("0");
      const indexes = await client.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname='public'
          and indexname='search_index_jobs_queue_expiry_idx'`,
      );
      expect(indexes.rows).toEqual([{ indexname: "search_index_jobs_queue_expiry_idx" }]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
