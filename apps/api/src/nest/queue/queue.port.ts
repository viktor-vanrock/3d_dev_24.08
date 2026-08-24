import type { AssistantRunV1QueueJob, GenerationV2QueueJob } from "@portal/contracts/jobs/giga";
import type { MeshConversionV1QueueJob } from "@portal/contracts/jobs/mesh";
import type { ModelIndexV1QueueJob } from "@portal/contracts/jobs/search";
import type { ProjectSliceRequestV1QueueJob } from "@portal/contracts/jobs/slicer-plate";

export const QUEUE_PORT = Symbol("QUEUE_PORT");

export type QueueJob = ModelIndexV1QueueJob | MeshConversionV1QueueJob | ProjectSliceRequestV1QueueJob | GenerationV2QueueJob | AssistantRunV1QueueJob;

export type { AssistantRunV1QueueJob, GenerationV2QueueJob, MeshConversionV1QueueJob, ModelIndexV1QueueJob, ProjectSliceRequestV1QueueJob };

export interface QueueEnqueueResult {
  readonly enqueued: boolean;
  readonly generation?: string;
}

export interface QueuePort {
  enqueue(job: QueueJob): Promise<QueueEnqueueResult>;
}
