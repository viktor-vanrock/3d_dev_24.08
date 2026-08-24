import type { ProjectSliceRequestV1QueueJob } from "@portal/contracts/jobs/slicer-plate";
import type { Pool } from "pg";

export class ProjectSliceEnqueueRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(job: ProjectSliceRequestV1QueueJob): Promise<{ readonly enqueued: boolean }> {
    const result = await this.pool.query(
      `insert into slice_jobs
         (id, model_id, profile_id, filament_profile_id, scale, requested_by,
          account_id, device_id, slice_key, slice_trust_contract_version,
          slice_trust_material, slice_trust_key_id, slice_trust_signature,
          layout_snapshot_id, layout, intent, preflight, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending')
       on conflict (account_id, slice_key, requested_by, model_id) do nothing
       returning id`,
      [
        job.jobId,
        job.modelId,
        job.profileId,
        job.filamentProfileId,
        job.scale,
        job.requestedBy,
        job.accountId,
        job.deviceId,
        Buffer.from(job.sliceKey),
        job.trust.material.contract_version,
        job.trust.material,
        job.trust.keyId,
        job.trust.signature,
        job.layout.layout_snapshot_id,
        job.layout,
        job.intent,
        job.preflight,
      ],
    );
    return { enqueued: result.rows[0] !== undefined };
  }
}
