import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.QUEUE_LIFECYCLE_SCHEMA_TEST === "1";

describe("model revision queue lifecycle migration", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("preserves every revision status with backward-compatible lifecycle defaults", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const modelId = randomUUID();
    const revisions = ["uploaded", "pending", "processing", "ready", "failed"].map((status) => ({ id: randomUUID(), status }));

    try {
      const database = await client.query<{ name: string }>("select current_database() as name");
      const databaseName = database.rows[0]?.name ?? "";
      if (["portal", "portal_dev", "postgres"].includes(databaseName) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(databaseName)) {
        throw new Error(`refusing queue lifecycle migration test against non-disposable database '${databaseName}'`);
      }

      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query("insert into users (id, username) values ($1, $2)", [ownerId, `queue-lifecycle-${ownerId}`]);
      await client.query("insert into projects (id, owner_id, title) values ($1, $2, 'Queue lifecycle migration')", [projectId, ownerId]);
      await client.query(
        `insert into models (id, project_id, name, position, latest_revision_id)
         values ($1, $2, 'Lifecycle model', 0, $3)`,
        [modelId, projectId, revisions[0]?.id],
      );
      for (const [index, revision] of revisions.entries()) {
        await client.query(
          `insert into model_revisions
             (id, model_id, source_format, status, source_checksum, source_size_bytes,
              processing_started_at, ready_at, failed_at)
           values ($1, $2, 'stl', $3, decode(repeat($4, 32), 'hex'), 128,
                   case when $3 = 'processing' then now() else null end,
                   case when $3 = 'ready' then now() else null end,
                   case when $3 = 'failed' then now() else null end)`,
          [revision.id, modelId, revision.status, (index + 1).toString(16).padStart(2, "0")],
        );
      }
      await client.query("set constraints all immediate");

      const rows = await client.query<{
        status: string;
        leased_by: string | null;
        lease_generation: string;
        attempts: number;
        lease_expires_at: Date | null;
      }>(
        `select status, leased_by, lease_generation::text, attempts, lease_expires_at
           from model_revisions
          where model_id = $1
          order by array_position(array['uploaded','pending','processing','ready','failed'], status)`,
        [modelId],
      );
      expect(rows.rows).toEqual(
        revisions.map(({ status }) => ({
          status,
          leased_by: null,
          lease_generation: "0",
          attempts: 0,
          lease_expires_at: null,
        })),
      );

      const indexes = await client.query<{ indexname: string }>(
        `select indexname
           from pg_indexes
          where schemaname = 'public'
            and indexname = any($1::text[])
          order by indexname`,
        [["model_revisions_queue_claim_idx", "model_revisions_queue_expiry_idx"]],
      );
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(["model_revisions_queue_claim_idx", "model_revisions_queue_expiry_idx"]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
