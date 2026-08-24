import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.SLICE_QUEUE_LIFECYCLE_SCHEMA_TEST === "1";

describe("slice job queue lifecycle migration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("preserves domain attempt_count and adds independent lifecycle defaults", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const modelId = randomUUID();
    const revisionId = randomUUID();
    const profileId = randomUUID();

    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const databaseName = database.rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
        throw new Error(`refusing slice lifecycle migration test against non-disposable database '${databaseName}'`);
      }

      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query("insert into users (id, username) values ($1, $2)", [ownerId, `slice-lifecycle-${ownerId}`]);
      await client.query("insert into projects (id, owner_id, title) values ($1, $2, 'Slice lifecycle migration')", [projectId, ownerId]);
      await client.query("insert into models (id, project_id, name, position, latest_revision_id) values ($1, $2, 'Slice model', 0, $3)", [modelId, projectId, revisionId]);
      await client.query(
        `insert into model_revisions(id, model_id, source_format, source_checksum, source_size_bytes)
         values ($1, $2, '3mf', decode(repeat('11', 32), 'hex'), 128)`,
        [revisionId, modelId],
      );
      await client.query(
        `insert into slicer_profiles(id, profile_class, slicer, name, source_name, license)
         values ($1, 'process', 'prusaslicer', 'Lifecycle profile', 'test', 'test')`,
        [profileId],
      );
      for (const [index, status] of ["pending", "processing", "ready", "failed"].entries()) {
        await client.query(
          `insert into slice_jobs(model_id, profile_id, status, attempt_count)
           values ($1, $2, $3, $4)`,
          [modelId, profileId, status, index + 7],
        );
      }
      await client.query("set constraints all immediate");

      const rows = await client.query<{
        status: string;
        attempt_count: number;
        leased_by: string | null;
        lease_generation: string;
        lifecycle_attempts: number;
        lease_expires_at: Date | null;
      }>(
        `select status, attempt_count, leased_by, lease_generation::text,
                lifecycle_attempts, lease_expires_at
           from slice_jobs where model_id = $1 order by attempt_count`,
        [modelId],
      );
      expect(rows.rows).toEqual(
        ["pending", "processing", "ready", "failed"].map((status, index) => ({
          status,
          attempt_count: index + 7,
          leased_by: null,
          lease_generation: "0",
          lifecycle_attempts: 0,
          lease_expires_at: null,
        })),
      );

      const indexes = await client.query<{ indexname: string }>(
        `select indexname from pg_indexes
          where schemaname = 'public' and indexname = any($1::text[])
          order by indexname`,
        [["slice_jobs_queue_claim_idx", "slice_jobs_queue_expiry_idx"]],
      );
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(["slice_jobs_queue_claim_idx", "slice_jobs_queue_expiry_idx"]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
