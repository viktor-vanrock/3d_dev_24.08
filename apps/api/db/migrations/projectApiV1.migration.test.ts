import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.PROJECT_API_V1_SCHEMA_TEST === "1";

async function expectForeignKeyViolation(client: PoolClient, statement: string, values: readonly unknown[]) {
  await client.query("savepoint invalid_ownership");
  try {
    await client.query(statement, [...values]);
    await expect(client.query("set constraints all immediate")).rejects.toMatchObject({ code: "23503" });
  } finally {
    await client.query("rollback to savepoint invalid_ownership");
    await client.query("release savepoint invalid_ownership");
    await client.query("set constraints all deferred");
  }
}

describe("Project API v1 database invariants", () => {
  it.skipIf(!DATABASE_URL || !ENABLED)("keeps aggregate pointers and publication snapshots inside their owning project", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const ownerId = randomUUID();
    const projectA = randomUUID();
    const projectB = randomUUID();
    const modelA = randomUUID();
    const modelB = randomUUID();
    const revisionA = randomUUID();
    const revisionB = randomUUID();
    const publicationA = randomUUID();

    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query("insert into users (id, username) values ($1, $2)", [ownerId, `project-api-v1-${ownerId}`]);
      await client.query("insert into projects (id, owner_id, title, primary_model_id) values ($1, $2, 'A', $3), ($4, $2, 'B', $5)", [projectA, ownerId, modelA, projectB, modelB]);
      await client.query(
        `insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
           values ($1, $2, 'A-1', 0, $3, $3), ($4, $5, 'B-1', 0, $6, $6)`,
        [modelA, projectA, revisionA, modelB, projectB, revisionB],
      );
      await client.query(
        `insert into model_revisions
             (id, model_id, source_format, status, source_checksum, source_size_bytes, ready_at)
           values ($1, $2, 'stl', 'ready', decode(repeat('11', 32), 'hex'), 128, now()),
                  ($3, $4, '3mf', 'ready', decode(repeat('22', 32), 'hex'), 256, now())`,
        [revisionA, modelA, revisionB, modelB],
      );
      await client.query(
        `insert into project_revisions
             (id, project_id, content_hash, primary_model_id, metadata_snapshot)
           values ($1, $2, decode(repeat('33', 32), 'hex'), $3, '{"title":"A"}'::jsonb)`,
        [publicationA, projectA, modelA],
      );
      await client.query(
        `insert into project_revision_models
             (project_revision_id, project_id, model_id, model_revision_id, position)
           values ($1, $2, $3, $4, 0)`,
        [publicationA, projectA, modelA, revisionA],
      );
      await client.query("update projects set published_revision_id = $2 where id = $1", [projectA, publicationA]);
      await client.query("set constraints all immediate");
      await client.query("set constraints all deferred");

      await client.query("savepoint immutable_publication");
      await expect(client.query('update project_revisions set metadata_snapshot = \'{"title":"mutated"}\'::jsonb where id = $1', [publicationA])).rejects.toMatchObject({
        code: "55000",
        message: "project_publication_snapshot_is_immutable",
      });
      await client.query("rollback to savepoint immutable_publication");
      await client.query("release savepoint immutable_publication");

      await expectForeignKeyViolation(client, "update projects set primary_model_id = $2 where id = $1", [projectA, modelB]);
      await expectForeignKeyViolation(client, "update models set latest_revision_id = $2 where id = $1", [modelA, revisionB]);
      await expectForeignKeyViolation(client, "update projects set published_revision_id = $2 where id = $1", [projectB, publicationA]);
      await expectForeignKeyViolation(
        client,
        `insert into project_revision_models
             (project_revision_id, project_id, model_id, model_revision_id, position)
           values ($1, $2, $3, $4, 1)`,
        [publicationA, projectA, modelB, revisionB],
      );

      await client.query("update projects set deleted_at = now(), deleted_by = $2 where id = $1", [projectA, ownerId]);
      await client.query("update models set deleted_at = now() where project_id = $1", [projectA]);
      const retained = await client.query<{ projects: string; models: string; publications: string }>(
        `select
             (select count(*) from projects where id = $1 and deleted_at is not null)::text as projects,
             (select count(*) from models where project_id = $1 and deleted_at is not null)::text as models,
             (select count(*) from project_revisions where project_id = $1)::text as publications`,
        [projectA],
      );
      expect(retained.rows[0]).toEqual({ projects: "1", models: "1", publications: "1" });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("matches the greenfield Project API v1 schema", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
      const objects = await pool.query<{ name: string }>(
        `select c.relname as name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = any($1::text[])
          order by c.relname`,
        [["idempotency_records", "model_revision_files", "outbox_events", "project_manifest_resolutions", "project_revision_models", "project_revisions"]],
      );
      expect(objects.rows.map(({ name }) => name)).toEqual([
        "idempotency_records",
        "model_revision_files",
        "outbox_events",
        "project_manifest_resolutions",
        "project_revision_models",
        "project_revisions",
      ]);

      const legacyObjects = await pool.query<{ count: string }>(
        `select count(*)::text as count
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname = any($1::text[])`,
        [["model_files", "models_compat_v1", "project_read_v1"]],
      );
      expect(legacyObjects.rows[0]?.count).toBe("0");

      const deferredConstraints = await pool.query<{ conname: string; condeferred: boolean }>(
        `select conname, condeferred
           from pg_constraint
          where conname = any($1::text[])
          order by conname`,
        [["models_active_revision_fkey", "models_latest_revision_fkey", "projects_primary_model_fkey", "projects_published_revision_fkey"]],
      );
      expect(deferredConstraints.rows).toEqual([
        { conname: "models_active_revision_fkey", condeferred: true },
        { conname: "models_latest_revision_fkey", condeferred: true },
        { conname: "projects_primary_model_fkey", condeferred: true },
        { conname: "projects_published_revision_fkey", condeferred: true },
      ]);
    } finally {
      await pool.end();
    }
  });
});
