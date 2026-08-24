import type { MeshConversionV1QueueJob } from "@portal/contracts/jobs/mesh";
import type { Pool } from "pg";

export class MeshConversionEnqueueRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(job: MeshConversionV1QueueJob): Promise<{ readonly enqueued: boolean }> {
    const result = await this.pool.query(
      `insert into outbox_events
         (id, aggregate_type, aggregate_id, event_type, event_version, payload)
       values ($1, 'ModelRevision', $2, 'model.revision.uploaded.v1', 1,
               jsonb_build_object(
                 'project_id', $3::uuid,
                 'model_id', $4::uuid,
                 'revision_id', $2::uuid,
                 'correlation_id', $5::uuid
               ))
       on conflict (id) do nothing
       returning id`,
      [job.eventId, job.revisionId, job.projectId, job.modelId, job.correlationId],
    );
    return { enqueued: result.rows[0] !== undefined };
  }
}
