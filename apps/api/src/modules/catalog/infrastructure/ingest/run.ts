import { createHash } from "node:crypto";
import { pool } from "../../../../db/client.ts";
import type { IngestRunResult, RawCandidate, SourceAdapter } from "./types.ts";

function hashRaw(raw: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(raw)).digest();
}

function isValid(item: RawCandidate): boolean {
  return item.externalRef.trim().length > 0 && item.raw !== null && item.raw !== undefined;
}

// Один прогон одного адаптера-источника (MF-406): fetch → идемпотентный upsert в
// machine_candidates по content_hash (тот же контент, что в прошлый раз, — пропускаем,
// ре-ингест только изменившегося) → аудит-лог в ingest_runs (found/changed/rejected).
// Дедуп/матчинг/merge сырых кандидатов в канон machines — отдельный пайплайн ниже по
// течению (не здесь, см. декомпозицию MF-406), runIngest только наполняет очередь.
export async function runIngest(adapter: SourceAdapter): Promise<IngestRunResult> {
  const startedAt = new Date();
  let found = 0;
  let changed = 0;
  let rejected = 0;
  let errorMessage: string | null = null;

  try {
    const items = await adapter.fetch();
    found = items.length;

    for (const item of items) {
      if (!isValid(item)) {
        rejected += 1;
        continue;
      }

      const hash = hashRaw(item.raw);
      const existing = await pool.query<{ content_hash: Buffer | null }>(`select content_hash from machine_candidates where source = $1 and external_ref = $2`, [
        adapter.id,
        item.externalRef,
      ]);
      const previousHash = existing.rows[0]?.content_hash ?? null;
      if (previousHash && Buffer.compare(previousHash, hash) === 0) {
        continue; // тот же контент — ре-ингест пропущен, unchanged не входит в found/changed/rejected
      }

      await pool.query(
        `insert into machine_candidates (source, source_url, external_ref, raw, content_hash, status)
         values ($1, $2, $3, $4, $5, 'pending')
         on conflict (source, external_ref)
         do update set raw = excluded.raw, source_url = excluded.source_url,
           content_hash = excluded.content_hash, status = 'pending', updated_at = now()`,
        [adapter.id, item.sourceUrl ?? null, item.externalRef, JSON.stringify(item.raw), hash],
      );
      changed += 1;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await pool.query(
      `insert into ingest_runs (source, started_at, found, changed, rejected, error)
       values ($1, $2, $3, $4, $5, $6)`,
      [adapter.id, startedAt, found, changed, rejected, errorMessage],
    );
  }

  return { found, changed, rejected };
}
