import { randomUUID } from "node:crypto";
import type { SliceTrustMaterial } from "@portal/contracts/jobs/slicer";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgQueueAdapter } from "./pg-queue.adapter.ts";
import type { QueueJob } from "./queue.port.ts";

const DATABASE_URL = process.env.DATABASE_URL;
const canRun = Boolean(DATABASE_URL);

describe.skipIf(!canRun)("PgQueueAdapter PostgreSQL producers", () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const ids = {
    user: randomUUID(),
    project: randomUUID(),
    model: randomUUID(),
    revision: randomUUID(),
    profile: randomUUID(),
    thread: randomUUID(),
    message: randomUUID(),
    run: randomUUID(),
    generation: randomUUID(),
    slice: randomUUID(),
    event: randomUUID(),
    correlation: randomUUID(),
  };

  beforeAll(async () => {
    const database = await pool.query<{ name: string }>("select current_database() as name");
    const name = database.rows[0]?.name ?? "";
    if (["portal", "portal_dev", "postgres"].includes(name) || !/(?:^test_|^sandbox_|_test$|_sandbox$)/.test(name)) {
      throw new Error(`refusing queue producer integration against non-disposable database '${name}'`);
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query("insert into users(id,username) values($1,$2)", [ids.user, `queue-producer-${ids.user}`]);
      await client.query("insert into projects(id,owner_id,title) values($1,$2,'Queue producer')", [ids.project, ids.user]);
      await client.query("insert into models(id,project_id,name,position,latest_revision_id) values($1,$2,'Part',0,$3)", [ids.model, ids.project, ids.revision]);
      await client.query(
        `insert into model_revisions(id,model_id,source_format,status,source_checksum,source_size_bytes)
         values($1,$2,'stl','uploaded',decode(repeat('11',32),'hex'),128)`,
        [ids.revision, ids.model],
      );
      await client.query(
        `insert into slicer_profiles(id,profile_class,slicer,name,source_name,license)
         values($1,'process','orcaslicer','Queue profile','queue-test','test')`,
        [ids.profile],
      );
      await client.query("insert into assistant_threads(id,owner_id) values($1,$2)", [ids.thread, ids.user]);
      await client.query("insert into assistant_messages(id,thread_id,role,content) values($1,$2,'user','Build a cube')", [ids.message, ids.thread]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query("delete from assistant_runs where id=$1", [ids.run]);
      await client.query("delete from assistant_messages where id=$1", [ids.message]);
      await client.query("delete from assistant_threads where id=$1", [ids.thread]);
      await client.query("delete from generations where id=$1", [ids.generation]);
      await client.query("delete from slice_jobs where id=$1", [ids.slice]);
      await client.query("delete from outbox_events where id=$1", [ids.event]);
      await client.query("delete from search_index_jobs where model_id=$1", [ids.project]);
      await client.query("delete from model_revisions where id=$1", [ids.revision]);
      await client.query("delete from models where id=$1", [ids.model]);
      await client.query("delete from projects where id=$1", [ids.project]);
      await client.query("delete from slicer_profiles where id=$1", [ids.profile]);
      await client.query("delete from users where id=$1", [ids.user]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("enqueues every closed job kind without granting leases or incrementing attempts", async () => {
    const fingerprint = "1".repeat(64);
    const trust: SliceTrustMaterial = {
      contract_version: "slice-trust.v1",
      account_id: ids.user,
      device_id: "device-none",
      profile_id: ids.profile,
      slice_key: fingerprint,
      fingerprint_source: "agent",
      fingerprint_state: "stock",
      fingerprint_algorithm_version: "config-fingerprint.v1",
      config_fingerprint: fingerprint,
      canonical_config_fingerprint: fingerprint,
      cross_account_reuse: false,
      global_dedup_eligible: false,
    };
    const jobs: readonly QueueJob[] = [
      {
        queue: "model-index.v1",
        correlationId: ids.correlation,
        modelId: ids.project,
        embeddingModel: "hyperpc/qwen3-vl-embedding-2b",
        embeddingVersion: "v1",
        dimensions: 2048,
        textSha256: Buffer.alloc(32, 1),
      },
      {
        queue: "mesh-conversion.v1",
        eventId: ids.event,
        projectId: ids.project,
        modelId: ids.model,
        revisionId: ids.revision,
        correlationId: ids.correlation,
      },
      {
        queue: "project-slice-request.v1",
        jobId: ids.slice,
        modelId: ids.model,
        profileId: ids.profile,
        filamentProfileId: null,
        scale: 1,
        requestedBy: ids.user,
        accountId: ids.user,
        deviceId: null,
        sliceKey: Buffer.alloc(32, 2),
        trust: { material: trust, keyId: "test-key", signature: "signed" },
        layout: {
          layout_snapshot_id: "layout-integration",
          bed_geometry: { shape: "rect", width_mm: 250, depth_mm: 210, origin: "front_left" },
          instances: [
            {
              instance_id: "part-1",
              source: {
                model_id: ids.model,
                revision: "a".repeat(40),
                configuration_id: "default",
                configuration_digest: "2".repeat(64),
                workflow_step_id: "export",
                artifact_id: "canonical",
                artifact_sha256: "3".repeat(64),
              },
              x_mm: 0,
              y_mm: 0,
              rotation_z_deg: 0,
              scale: 1,
            },
          ],
        },
        intent: { supports: "auto" },
        preflight: { ok: true, instances: [{ instance_id: "part-1", ok: true, codes: [] }] },
      },
      {
        queue: "generation.v2",
        generationId: ids.generation,
        accountId: ids.user,
        branch: "openscad",
        prompt: "cube",
        params: { size: 20 },
        assistantOfferId: null,
        sourceGenerationId: null,
        sourceAngles: null,
      },
      {
        queue: "assistant-run.v1",
        runId: ids.run,
        threadId: ids.thread,
        triggeringMessageId: ids.message,
        accountId: ids.user,
        message: "Build a cube",
      },
    ];
    const adapter = new PgQueueAdapter(pool);

    for (const job of jobs) {
      await expect(adapter.enqueue(job)).resolves.toMatchObject({ enqueued: true });
      await expect(adapter.enqueue(job)).resolves.toEqual({ enqueued: false });
    }

    await expect(
      pool.query(
        `select status,attempts,lease_generation,leased_by,leased_until
           from search_index_jobs where model_id=$1`,
        [ids.project],
      ),
    ).resolves.toMatchObject({ rows: [{ status: "queued", attempts: 0, lease_generation: "0", leased_by: null, leased_until: null }] });
    await expect(
      pool.query(
        `select status,lifecycle_attempts,lease_generation,leased_by,lease_expires_at
           from slice_jobs where id=$1`,
        [ids.slice],
      ),
    ).resolves.toMatchObject({ rows: [{ status: "pending", lifecycle_attempts: 0, lease_generation: "0", leased_by: null, lease_expires_at: null }] });
    await expect(
      pool.query(
        `select status,attempts,lease_generation,leased_by,lease_expires_at
           from generations where id=$1`,
        [ids.generation],
      ),
    ).resolves.toMatchObject({ rows: [{ status: "queued", attempts: 0, lease_generation: "0", leased_by: null, lease_expires_at: null }] });
    await expect(
      pool.query(
        `select status,attempts,lease_generation,leased_by,lease_expires_at
           from assistant_runs where id=$1`,
        [ids.run],
      ),
    ).resolves.toMatchObject({ rows: [{ status: "queued", attempts: 0, lease_generation: "0", leased_by: null, lease_expires_at: null }] });
    const event = await pool.query<{ correlation_id: string }>("select payload->>'correlation_id' as correlation_id from outbox_events where id=$1", [ids.event]);
    expect(event.rows).toEqual([{ correlation_id: ids.correlation }]);
  });
});
