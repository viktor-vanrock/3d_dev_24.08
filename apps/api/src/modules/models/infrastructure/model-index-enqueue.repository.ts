import type { ModelIndexV1QueueJob } from "@portal/contracts/jobs/search";
import type { Pool } from "pg";

export class ModelIndexEnqueueRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(job: ModelIndexV1QueueJob): Promise<{ readonly enqueued: boolean; readonly generation?: string }> {
    const result = await this.pool.query<{ generation: string }>(
      `insert into search_index_jobs
         (model_id, embedding_model, embedding_version, dim, text_sha256, status, generation, correlation_id)
       values ($1, $2, $3, $4, $5, 'queued', 1, $6)
       on conflict (model_id, embedding_model, embedding_version) do update
         set text_sha256 = excluded.text_sha256,
             status = 'queued',
             generation = search_index_jobs.generation + 1,
             correlation_id = excluded.correlation_id,
             updated_at = now()
         where search_index_jobs.text_sha256 is distinct from excluded.text_sha256
            or search_index_jobs.status = 'failed'
       returning generation::text`,
      [job.modelId, job.embeddingModel, job.embeddingVersion, job.dimensions, Buffer.from(job.textSha256), job.correlationId],
    );
    const row = result.rows[0];
    return row === undefined ? { enqueued: false } : { enqueued: true, generation: row.generation };
  }
}
