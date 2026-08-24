import type { ModelId, ModelRevisionId, ProjectId, UserId } from "../../_kernel/brandedIds.ts";

export const PROJECT_COMMAND_SERVICE = Symbol("PROJECT_COMMAND_SERVICE");
export const PROJECT_QUERY_SERVICE = Symbol("PROJECT_QUERY_SERVICE");
export const PROJECT_PROCESSING_SERVICE = Symbol("PROJECT_PROCESSING_SERVICE");

export interface ProjectProcessingPort {
  markPending(revisionId: ModelRevisionId): Promise<boolean>;
  markProcessing(revisionId: ModelRevisionId): Promise<boolean>;
  markReady(revisionId: ModelRevisionId): Promise<boolean>;
  markFailed(revisionId: ModelRevisionId, code: string, detailSafe?: string): Promise<boolean>;
}

export interface ProjectIdentityPort {
  readonly projectId: ProjectId;
  readonly modelId: ModelId;
  readonly revisionId: ModelRevisionId;
  readonly actorId: UserId;
}
