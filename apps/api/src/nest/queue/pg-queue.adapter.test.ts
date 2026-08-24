import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PgQueueAdapter } from "./pg-queue.adapter.ts";
import type { AssistantRunV1QueueJob, GenerationV2QueueJob, MeshConversionV1QueueJob, ModelIndexV1QueueJob, ProjectSliceRequestV1QueueJob, QueueJob } from "./queue.port.ts";

const IDS = {
  account: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  model: "33333333-3333-4333-8333-333333333333",
  revision: "44444444-4444-4444-8444-444444444444",
  event: "55555555-5555-4555-8555-555555555555",
  correlation: "66666666-6666-4666-8666-666666666666",
  profile: "77777777-7777-4777-8777-777777777777",
  slice: "88888888-8888-4888-8888-888888888888",
  thread: "99999999-9999-4999-8999-999999999999",
  message: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  run: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  generation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

function modelIndexJob(): ModelIndexV1QueueJob {
  return {
    queue: "model-index.v1",
    correlationId: IDS.correlation,
    modelId: IDS.project,
    embeddingModel: "hyperpc/qwen3-vl-embedding-2b",
    embeddingVersion: "v1",
    dimensions: 2048,
    textSha256: Buffer.alloc(32, 1),
  };
}

function meshJob(): MeshConversionV1QueueJob {
  return {
    queue: "mesh-conversion.v1",
    eventId: IDS.event,
    projectId: IDS.project,
    modelId: IDS.model,
    revisionId: IDS.revision,
    correlationId: IDS.correlation,
  };
}

function sliceJob(): ProjectSliceRequestV1QueueJob {
  const fingerprint = "1".repeat(64);
  return {
    queue: "project-slice-request.v1",
    jobId: IDS.slice,
    modelId: IDS.model,
    profileId: IDS.profile,
    filamentProfileId: null,
    scale: 1,
    requestedBy: IDS.account,
    accountId: IDS.account,
    deviceId: null,
    sliceKey: Buffer.alloc(32, 2),
    trust: {
      material: {
        contract_version: "slice-trust.v1",
        account_id: IDS.account,
        device_id: "device-none",
        profile_id: IDS.profile,
        slice_key: fingerprint,
        fingerprint_source: "agent",
        fingerprint_state: "stock",
        fingerprint_algorithm_version: "config-fingerprint.v1",
        config_fingerprint: fingerprint,
        canonical_config_fingerprint: fingerprint,
        cross_account_reuse: false,
        global_dedup_eligible: false,
      },
      keyId: "slice-key-v1",
      signature: "signed",
    },
    layout: {
      layout_snapshot_id: "layout-1",
      bed_geometry: { shape: "rect", width_mm: 250, depth_mm: 210, origin: "front_left" },
      instances: [
        {
          instance_id: "part-1",
          source: {
            model_id: IDS.model,
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
    intent: { quality: "appearance", supports: "auto" },
    preflight: { ok: true, instances: [{ instance_id: "part-1", ok: true, codes: [] }] },
  };
}

function generationJob(): GenerationV2QueueJob {
  return {
    queue: "generation.v2",
    generationId: IDS.generation,
    accountId: IDS.account,
    branch: "openscad",
    prompt: "cube",
    params: { size: 20, centered: true },
    assistantOfferId: null,
    sourceGenerationId: null,
    sourceAngles: null,
  };
}

function assistantJob(): AssistantRunV1QueueJob {
  return {
    queue: "assistant-run.v1",
    runId: IDS.run,
    threadId: IDS.thread,
    triggeringMessageId: IDS.message,
    accountId: IDS.account,
    message: "Build a cube",
  };
}

interface CapturedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function adapterWithCapture(rows: readonly object[] = [{ id: IDS.event }]): {
  readonly adapter: PgQueueAdapter;
  readonly queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];
  const pool = {
    query: (sql: string, params: readonly unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve({ rows });
    },
  };
  return { adapter: new PgQueueAdapter(pool as unknown as Pool), queries };
}

describe("PgQueueAdapter", () => {
  it.each([
    [modelIndexJob(), "search_index_jobs"],
    [meshJob(), "outbox_events"],
    [sliceJob(), "slice_jobs"],
    [generationJob(), "generations"],
    [assistantJob(), "assistant_runs"],
  ] as const)("dispatches %s to its domain-owned physical table", async (job, table) => {
    const { adapter, queries } = adapterWithCapture(job.queue === "model-index.v1" ? [{ generation: "7" }] : undefined);

    await expect(adapter.enqueue(job)).resolves.toMatchObject({ enqueued: true });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain(`insert into ${table}`);
    expect(queries[0]!.sql).not.toMatch(/insert into (?:queue_jobs|jobs_queue)/);
    expect(queries[0]!.sql).not.toMatch(/lease_generation|lifecycle_attempts|lease_expires_at|leased_by|attempts/);
  });

  it("preserves model-index hash gating and correlation generation semantics", async () => {
    const { adapter, queries } = adapterWithCapture([{ generation: "7" }]);

    await expect(adapter.enqueue(modelIndexJob())).resolves.toEqual({ enqueued: true, generation: "7" });

    expect(queries[0]!.sql).toContain("generation = search_index_jobs.generation + 1");
    expect(queries[0]!.sql).toContain("correlation_id = excluded.correlation_id");
    expect(queries[0]!.params[5]).toBe(IDS.correlation);
  });

  it("persists Mesh correlation inside the versioned domain event", async () => {
    const { adapter, queries } = adapterWithCapture();

    await adapter.enqueue(meshJob());

    expect(queries[0]!.sql).toContain("'correlation_id'");
    expect(queries[0]!.params[4]).toBe(IDS.correlation);
  });

  it("reports domain idempotency conflicts as a no-op", async () => {
    const { adapter } = adapterWithCapture([]);
    await expect(adapter.enqueue(generationJob())).resolves.toEqual({ enqueued: false });
  });

  it("rejects an unknown runtime discriminator", async () => {
    const { adapter, queries } = adapterWithCapture();
    const unsupported = { queue: "universal-job.v1" } as unknown as QueueJob;

    await expect(adapter.enqueue(unsupported)).rejects.toThrow("unsupported queue job 'universal-job.v1'");
    expect(queries).toHaveLength(0);
  });
});
