import type { AssistantRunV1QueueJob } from "@portal/contracts/jobs/giga";
import type { Pool } from "pg";

export class AssistantRunEnqueueRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(job: AssistantRunV1QueueJob): Promise<{ readonly enqueued: boolean }> {
    const result = await this.pool.query(
      `insert into assistant_runs
         (id, thread_id, triggering_message_id, user_id, message, status)
       values ($1,$2,$3,$4,$5,'queued')
       on conflict do nothing
       returning id`,
      [job.runId, job.threadId, job.triggeringMessageId, job.accountId, job.message],
    );
    return { enqueued: result.rows[0] !== undefined };
  }
}
