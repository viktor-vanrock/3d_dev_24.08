import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { computeModelIndexTextSha256, enqueueModelIndexJob, SEARCH_TEXT_EMBEDDING_DIM, SEARCH_TEXT_EMBEDDING_MODEL, SEARCH_TEXT_EMBEDDING_VERSION } from "./indexQueue.ts";
import { buildModelIndexText } from "./indexText.ts";

const canRun = Boolean(process.env.DATABASE_URL);
const ownerIds: string[] = [];

async function createOwnerAndModel(): Promise<string> {
  const owner = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`mf2013-${randomUUID()}`]);
  const ownerId = owner.rows[0]!.id;
  ownerIds.push(ownerId);
  const model = await pool.query<{ id: string }>(
    `with ids as (
       select gen_random_uuid() as project_id, gen_random_uuid() as child_id, gen_random_uuid() as revision_id
     ), p as (
       insert into projects (id, owner_id, title) select project_id, $1, 'index queue test' from ids returning id
     ), m as (
       insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
       select child_id, project_id, 'index queue test', 0, revision_id, revision_id from ids
     ), r as (
       insert into model_revisions (id, model_id, source_format, status, source_checksum, source_size_bytes, ready_at)
       select revision_id, child_id, 'stl', 'ready', decode(repeat('00', 32), 'hex'), 0, now() from ids
     )
     select id from p`,
    [ownerId],
  );
  return model.rows[0]!.id;
}

interface QueueRow {
  model_id: string;
  embedding_model: string;
  embedding_version: string;
  dim: number;
  text_sha256: Buffer;
  status: string;
  generation: string;
  attempts: number;
}

async function queueRow(modelId: string): Promise<QueueRow | undefined> {
  const result = await pool.query<QueueRow>(
    `select model_id, embedding_model, embedding_version, dim, text_sha256, status, generation, attempts
     from search_index_jobs where model_id = $1 and embedding_model = $2 and embedding_version = $3`,
    [modelId, SEARCH_TEXT_EMBEDDING_MODEL, SEARCH_TEXT_EMBEDDING_VERSION],
  );
  return result.rows[0];
}

describe.skipIf(!canRun)("model-index.v1 producer (enqueueModelIndexJob against search_index_jobs)", () => {
  afterEach(async () => {
    if (ownerIds.length === 0) return;
    await pool.query(`delete from projects where owner_id = any($1::uuid[])`, [ownerIds]);
    await pool.query(`delete from users where id = any($1::uuid[])`, [ownerIds]);
    ownerIds.length = 0;
  });

  it("computes text_sha256 the same way buildModelIndexText does, deterministically", () => {
    const model = { title: "Лапа манипулятора", description: "Захват для PO-3", tags: ["3d_printing", "robotics"] };
    const a = computeModelIndexTextSha256(model);
    const b = computeModelIndexTextSha256(model);
    expect(a.equals(b)).toBe(true);
    expect(a).toHaveLength(32);
  });

  it("inserts a queued row under the active gigachat/Embeddings v1/1024 identity on first enqueue", async () => {
    const modelId = await createOwnerAndModel();
    const model = { title: "Кронштейн", description: "Крепёж для DIN-рейки", tags: ["mount"] };

    const enqueued = await enqueueModelIndexJob(modelId, model);
    expect(enqueued).toBe(true);

    const row = await queueRow(modelId);
    expect(row).toMatchObject({
      embedding_model: SEARCH_TEXT_EMBEDDING_MODEL,
      embedding_version: SEARCH_TEXT_EMBEDDING_VERSION,
      dim: SEARCH_TEXT_EMBEDDING_DIM,
      status: "queued",
      generation: "1",
      attempts: 0,
    });
    expect(row!.text_sha256.equals(computeModelIndexTextSha256(model))).toBe(true);
  });

  it("hash-gates: re-enqueueing the exact same text is a no-op (no generation bump, still one row)", async () => {
    const modelId = await createOwnerAndModel();
    const model = { title: "Держатель катушки", description: "Для AMS", tags: ["filament"] };

    const first = await enqueueModelIndexJob(modelId, model);
    const second = await enqueueModelIndexJob(modelId, model);

    expect(first).toBe(true);
    expect(second).toBe(false);
    const row = await queueRow(modelId);
    expect(row!.generation).toBe("1");
  });

  it("debounces: re-enqueueing changed text while still queued bumps generation on the SAME row, not a second one", async () => {
    const modelId = await createOwnerAndModel();
    const draftOne = { title: "Держатель катушки v1", description: "Черновик", tags: ["filament"] };
    const draftTwo = { title: "Держатель катушки v2", description: "Черновик правка", tags: ["filament"] };

    await enqueueModelIndexJob(modelId, draftOne);
    const second = await enqueueModelIndexJob(modelId, draftTwo);

    expect(second).toBe(true);
    const row = await queueRow(modelId);
    expect(row!.generation).toBe("2");
    expect(row!.status).toBe("queued");
    expect(row!.text_sha256.equals(computeModelIndexTextSha256(draftTwo))).toBe(true);

    const count = await pool.query(`select count(*)::int as n from search_index_jobs where model_id = $1`, [modelId]);
    expect(count.rows[0]!.n).toBe(1);
  });

  it("does not touch a done row — only a fresh text change re-enqueues it", async () => {
    const modelId = await createOwnerAndModel();
    const model = { title: "Готовая модель", description: "Проиндексирована", tags: [] };
    await enqueueModelIndexJob(modelId, model);
    await pool.query(`update search_index_jobs set status = 'done' where model_id = $1`, [modelId]);

    const sameTextAgain = await enqueueModelIndexJob(modelId, model);
    expect(sameTextAgain).toBe(false);
    const rowAfterSame = await queueRow(modelId);
    expect(rowAfterSame!.status).toBe("done");
    expect(rowAfterSame!.generation).toBe("1");

    const changed = { ...model, title: "Готовая модель, переименована" };
    const afterChange = await enqueueModelIndexJob(modelId, changed);
    expect(afterChange).toBe(true);
    const rowAfterChange = await queueRow(modelId);
    expect(rowAfterChange!.status).toBe("queued");
    expect(rowAfterChange!.generation).toBe("2");
  });

  it("retries a failed row: same text after failed still re-queues (fresh attempt, generation bumps)", async () => {
    const modelId = await createOwnerAndModel();
    const model = { title: "Провалившаяся попытка", description: null, tags: [] };
    await enqueueModelIndexJob(modelId, model);
    await pool.query(`update search_index_jobs set status = 'failed', last_error = 'boom' where model_id = $1`, [modelId]);

    const retried = await enqueueModelIndexJob(modelId, model);
    expect(retried).toBe(true);
    const row = await queueRow(modelId);
    expect(row!.status).toBe("queued");
    expect(row!.generation).toBe("2");

    const count = await pool.query(`select count(*)::int as n from search_index_jobs where model_id = $1`, [modelId]);
    expect(count.rows[0]!.n).toBe(1);
  });

  it("matches buildModelIndexText's own hashing (no drift between the indexer and the producer)", () => {
    const model = { title: "T", description: "D", tags: ["a", "b"] };
    const expected = createHash("sha256").update(buildModelIndexText(model), "utf8").digest();
    expect(computeModelIndexTextSha256(model).equals(expected)).toBe(true);
  });
});
