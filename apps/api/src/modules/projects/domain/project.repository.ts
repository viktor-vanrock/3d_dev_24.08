import type { ModelId, ModelRevisionId, ProjectId, ProjectRevisionId, UserId } from "../../_kernel/brandedIds.ts";
import type { ModelCreateInput, ProjectMetadataInput, ProjectPatchInput, ProjectSourceFormat } from "./project.ts";

export interface ProjectOwner {
  readonly id: string;
  readonly username: string;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
}

export interface ModelRevisionView {
  readonly id: ModelRevisionId;
  readonly model_id: ModelId;
  readonly status: string;
  readonly source_format: ProjectSourceFormat;
  readonly craft: string;
  readonly manufacturing_method: string | null;
  readonly requires_ams: boolean;
  readonly bbox: unknown;
  readonly failure_code: string | null;
  readonly source_size_bytes: number;
  readonly source_checksum_sha256: string;
  readonly source_url: string;
  readonly preview_url: string | null;
  readonly created_at: Date;
  readonly processing_started_at: Date | null;
  readonly ready_at: Date | null;
  readonly failed_at: Date | null;
}

export interface ModelView {
  readonly id: ModelId;
  readonly project_id: ProjectId;
  readonly name: string;
  readonly position: number;
  readonly latest_revision_id: ModelRevisionId;
  readonly active_revision_id: ModelRevisionId | null;
  readonly latest_revision_status: string;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface ProjectView {
  readonly id: ProjectId;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly owner: ProjectOwner;
  readonly primary_model_id: ModelId | null;
  readonly published_revision_id: ProjectRevisionId | null;
  readonly models_count: number;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly repo_url?: string | null;
  readonly primary_model?: ModelView | null;
}

export interface PublishedProjectView extends ProjectView {
  readonly project_revision_id: ProjectRevisionId;
  readonly published_at: Date;
  readonly published_models: readonly ModelView[];
}

export interface MutationResult<T> {
  readonly value: T;
  readonly version: number;
  readonly replayed?: boolean;
}

export interface UploadedSource {
  readonly checksum: Buffer;
  readonly sizeBytes: number;
  readonly filename: string;
  readonly mimeType: string;
  readonly sourceFormat: ProjectSourceFormat;
  readonly craft: string;
  readonly role: string;
  readonly objectKey: string;
}

export interface ProjectRepository {
  createProject(actorId: UserId, input: ProjectMetadataInput, key: string, fingerprint: Buffer): Promise<MutationResult<ProjectView>>;
  listPublished(limit: number, cursor: readonly unknown[] | null): Promise<readonly ProjectView[]>;
  listOwned(actorId: UserId, limit: number, cursor: readonly unknown[] | null): Promise<readonly ProjectView[]>;
  getPublished(projectId: ProjectId): Promise<PublishedProjectView | null>;
  getDraft(actorId: UserId, projectId: ProjectId): Promise<ProjectView | null>;
  updateProject(actorId: UserId, projectId: ProjectId, version: number, patch: ProjectPatchInput): Promise<MutationResult<ProjectView>>;
  deleteProject(actorId: UserId, projectId: ProjectId, version: number): Promise<void>;
  createModel(
    actorId: UserId,
    projectId: ProjectId,
    version: number,
    input: ModelCreateInput,
    source: UploadedSource,
    key: string,
    fingerprint: Buffer,
  ): Promise<MutationResult<ModelView>>;
  listModels(actorId: UserId, projectId: ProjectId, limit: number, cursor: readonly unknown[] | null): Promise<readonly ModelView[] | null>;
  getModel(actorId: UserId, projectId: ProjectId, modelId: ModelId): Promise<ModelView | null>;
  deleteModel(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number): Promise<number>;
  createRevision(
    actorId: UserId,
    projectId: ProjectId,
    modelId: ModelId,
    version: number,
    source: UploadedSource,
    key: string,
    fingerprint: Buffer,
  ): Promise<MutationResult<ModelRevisionView>>;
  listRevisions(actorId: UserId, projectId: ProjectId, modelId: ModelId, limit: number, cursor: readonly unknown[] | null): Promise<readonly ModelRevisionView[] | null>;
  getRevision(actorId: UserId, projectId: ProjectId, modelId: ModelId, revisionId: ModelRevisionId): Promise<ModelRevisionView | null>;
  revisionAsset(actorId: UserId | null, projectId: ProjectId, modelId: ModelId, revisionId: ModelRevisionId, role: "source" | "preview"): Promise<string | null>;
  setPrimary(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number): Promise<MutationResult<ProjectView>>;
  clearPrimary(actorId: UserId, projectId: ProjectId, version: number): Promise<number>;
  publish(
    actorId: UserId,
    projectId: ProjectId,
    version: number,
  ): Promise<MutationResult<{ project_revision_id: ProjectRevisionId; project_id: ProjectId; version: number; published_at: Date }>>;
  unpublish(actorId: UserId, projectId: ProjectId, version: number): Promise<number>;
  transitionRevision(revisionId: ModelRevisionId, from: string, to: string, failure?: { code: string; detailSafe?: string }): Promise<boolean>;
}
