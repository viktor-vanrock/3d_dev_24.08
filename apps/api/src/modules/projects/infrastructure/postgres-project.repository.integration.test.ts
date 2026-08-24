import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModelId, ModelRevisionId, ProjectId, UserId } from "../../_kernel/brandedIds.ts";
import { sha256Canonical } from "../domain/project.ts";
import { ProjectError } from "../domain/project.errors.ts";
import type { UploadedSource } from "../domain/project.repository.ts";
import { ProjectProcessingService } from "../application/project-processing.service.ts";
import { PostgresProjectRepository } from "./postgres-project.repository.ts";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("Project aggregate concurrency and processing", () => {
  let pool: Pool;
  let repository: PostgresProjectRepository;
  let processing: ProjectProcessingService;
  const ownerId = UserId(randomUUID());
  const projectId = ProjectId(randomUUID());

  function source(marker: number): UploadedSource {
    const checksum = Buffer.alloc(32, marker);
    return {
      checksum,
      sizeBytes: marker + 1,
      filename: `fixture-${marker}.stl`,
      mimeType: "model/stl",
      sourceFormat: "stl",
      craft: "3d_printing",
      role: "source",
      objectKey: `protected/test/${ownerId}/${checksum.toString("hex")}`,
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    repository = new PostgresProjectRepository(pool);
    processing = new ProjectProcessingService(repository);
    await pool.query("insert into users(id, username) values ($1, $2)", [ownerId, `project-race-${ownerId}`]);
    await pool.query("insert into projects(id, owner_id, title) values ($1, $2, 'Race fixture')", [projectId, ownerId]);
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      await client.query("update projects set primary_model_id = null, published_revision_id = null where id = $1", [projectId]);
      await client.query("delete from project_revision_models where project_id = $1", [projectId]);
      await client.query("delete from project_revisions where project_id = $1", [projectId]);
      await client.query("delete from outbox_events where payload->>'project_id' = $1", [projectId]);
      await client.query("delete from models where project_id = $1", [projectId]);
      await client.query("delete from idempotency_records where actor_id = $1", [ownerId]);
      await client.query("delete from projects where id = $1", [projectId]);
      await client.query("delete from storage_blobs where owner_id = $1", [ownerId]);
      await client.query("delete from users where id = $1", [ownerId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("serializes two first-Model attempts, then retains the retried sibling with one primary", async () => {
    const first = repository.createModel(ownerId, projectId, 1, { name: "First" }, source(1), "model-1", sha256Canonical({ model: 1 }));
    const second = repository.createModel(ownerId, projectId, 1, { name: "Second" }, source(2), "model-2", sha256Canonical({ model: 2 }));
    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.find((result): result is PromiseFulfilledResult<Awaited<typeof first>> => result.status === "fulfilled");
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toBeDefined();
    expect(rejected?.reason).toMatchObject({ code: "project.version_conflict.v1" });

    const winner = fulfilled!.value.value;
    const loserInput =
      winner.name === "First"
        ? { name: "Second", source: source(2), key: "model-2", fingerprint: sha256Canonical({ model: 2 }) }
        : { name: "First", source: source(1), key: "model-1", fingerprint: sha256Canonical({ model: 1 }) };
    const retried = await repository.createModel(ownerId, projectId, 2, { name: loserInput.name }, loserInput.source, loserInput.key, loserInput.fingerprint);

    const rows = await pool.query<{ id: string; position: number }>("select id, position from models where project_id = $1 order by position, id", [projectId]);
    const project = await pool.query<{ primary_model_id: string; version: string }>("select primary_model_id, version from projects where id = $1", [projectId]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.position)).toEqual([0, 1]);
    expect(project.rows[0]?.primary_model_id).toBe(winner.id);
    expect(project.rows[0]?.version).toBe("3");
    expect(retried.value.id).not.toBe(winner.id);
  });

  it("retains parallel revisions after retry and never promotes a failed latest revision", async () => {
    const model = await pool.query<{ id: string }>("select id from models where project_id = $1 order by position limit 1", [projectId]);
    const modelId = ModelId(model.rows[0]!.id);
    const uploadA = repository.createRevision(ownerId, projectId, modelId, 3, source(3), "revision-3", sha256Canonical({ revision: 3 }));
    const uploadB = repository.createRevision(ownerId, projectId, modelId, 3, source(4), "revision-4", sha256Canonical({ revision: 4 }));
    const attempts = await Promise.allSettled([uploadA, uploadB]);
    const accepted = attempts.find((result): result is PromiseFulfilledResult<Awaited<typeof uploadA>> => result.status === "fulfilled")!.value;
    const failedAttempt = attempts.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(failedAttempt?.reason).toBeInstanceOf(ProjectError);
    const retrySource = accepted.value.source_checksum_sha256 === source(3).checksum.toString("hex") ? source(4) : source(3);
    const retryMarker = retrySource.checksum[0]!;
    const retried = await repository.createRevision(ownerId, projectId, modelId, 4, retrySource, `revision-${retryMarker}`, sha256Canonical({ revision: retryMarker }));

    const readyId = accepted.value.id;
    expect(await processing.markPending(readyId)).toBe(true);
    expect(await processing.markProcessing(readyId)).toBe(true);
    expect(await processing.markReady(readyId)).toBe(true);
    const activeAfterReady = await pool.query<{ active_revision_id: string }>("select active_revision_id from models where id = $1", [modelId]);
    expect(activeAfterReady.rows[0]?.active_revision_id).toBe(readyId);

    const failedId = ModelRevisionId(retried.value.id);
    expect(await processing.markPending(failedId)).toBe(true);
    expect(await processing.markProcessing(failedId)).toBe(true);
    expect(await processing.markFailed(failedId, "fixture.failed")).toBe(true);
    const pointers = await pool.query<{ latest_revision_id: string; active_revision_id: string }>("select latest_revision_id, active_revision_id from models where id = $1", [
      modelId,
    ]);
    expect(pointers.rows[0]).toEqual({ latest_revision_id: failedId, active_revision_id: readyId });
    expect(await processing.markReady(failedId)).toBe(false);
  });
});
