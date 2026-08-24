import type { GenerationV2QueueJob } from "@portal/contracts/jobs/giga";
import type { Pool } from "pg";

export class GenerationEnqueueRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(job: GenerationV2QueueJob): Promise<{ readonly enqueued: boolean }> {
    const result = await this.pool.query(
      `insert into generations
         (id, user_id, branch, prompt, params, assistant_offer_id,
          source_generation_id, source_angles, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'queued')
       on conflict (id) do nothing
       returning id`,
      [job.generationId, job.accountId, job.branch, job.prompt, job.params, job.assistantOfferId, job.sourceGenerationId, job.sourceAngles],
    );
    return { enqueued: result.rows[0] !== undefined };
  }
}
