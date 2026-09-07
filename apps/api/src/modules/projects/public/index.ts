import type { ModelId, ModelRevisionId, ProjectId, UserId } from "../../_kernel/brandedIds.ts";
export { OUTBOX_PORT, type ClaimedOutboxEvent, type OutboxPort } from "./outbox.ts";

export const PROJECT_COMMAND_SERVICE = Symbol("PROJECT_COMMAND_SERVICE");
export const PROJECT_QUERY_SERVICE = Symbol("PROJECT_QUERY_SERVICE");
export const PROJECT_PROCESSING_SERVICE = Symbol("PROJECT_PROCESSING_SERVICE");

export interface ProjectReadView {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly owner: {
    readonly id: string;
    readonly username: string;
    readonly display_name: string | null;
    readonly avatar_url: string | null;
  };
  readonly publication_state: "draft" | "published";
  readonly primary_model_id: string | null;
  readonly repo_url: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly primary_model: {
    readonly id: string;
    readonly name: string;
    readonly latest_revision_id: string;
    readonly active_revision_id: string | null;
    readonly latest_revision_status: string;
  } | null;
}

export interface ProjectReadPort {
  getPublished(id: string): Promise<ProjectReadView | null>;
  getDraft(id: string, userId: string): Promise<ProjectReadView | null>;
}

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
