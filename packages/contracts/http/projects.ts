export const PROJECT_API_CONTRACT_VERSION = "project-api.v1" as const;
export const PROJECT_SOURCE_FORMATS = ["stl", "obj", "3mf", "step", "dxf", "svg", "gcode", "gerber", "zip"] as const;
export const PROJECT_CRAFTS = ["3d_printing", "cnc", "electronics", "software"] as const;
export const PROJECT_MANUFACTURING_METHODS = ["fdm", "sla", "cnc", "laser"] as const;
export const PROJECT_REVISION_STATUSES = ["uploaded", "pending", "processing", "ready", "failed"] as const;

export type ProjectSourceFormat = (typeof PROJECT_SOURCE_FORMATS)[number];
export type ProjectCraft = (typeof PROJECT_CRAFTS)[number];
export type ProjectManufacturingMethod = (typeof PROJECT_MANUFACTURING_METHODS)[number];
export type ProjectRevisionStatus = (typeof PROJECT_REVISION_STATUSES)[number];

export interface CreateProjectRequest {
  readonly title: string;
  readonly description?: string | null;
  readonly tags?: readonly string[];
  readonly repo_url?: string | null;
}

export interface UpdateProjectRequest {
  readonly title?: string;
  readonly description?: string | null;
  readonly tags?: readonly string[];
  readonly repo_url?: string | null;
}

export interface SetPrimaryModelRequest {
  readonly model_id: string;
}

export interface ProjectOwner {
  readonly id: string;
  readonly username: string;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
}

export interface ModelSummary {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly position: number;
  readonly latest_revision_id: string;
  readonly active_revision_id: string | null;
  readonly latest_revision_status: ProjectRevisionStatus;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly owner: ProjectOwner;
  readonly publication_state: "draft" | "published";
  readonly primary_model_id: string | null;
  readonly published_revision_id: string | null;
  readonly models_count: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ProjectDraft extends ProjectSummary {
  readonly repo_url: string | null;
  readonly primary_model: ModelSummary | null;
}

export interface PublishedProject extends ProjectSummary {
  readonly project_revision_id: string;
  readonly published_at: string;
  readonly published_models: readonly ModelSummary[];
}

export interface BboxMm {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly unit: "mm";
}

export interface ModelRevision {
  readonly id: string;
  readonly model_id: string;
  readonly status: ProjectRevisionStatus;
  readonly source_format: ProjectSourceFormat;
  readonly craft: ProjectCraft;
  readonly manufacturing_method: ProjectManufacturingMethod | null;
  readonly requires_ams: boolean;
  readonly bbox: BboxMm | null;
  readonly failure_code: string | null;
  readonly source_size_bytes: number;
  readonly source_checksum_sha256: string;
  readonly source_url: string;
  readonly preview_url: string | null;
  readonly created_at: string;
  readonly processing_started_at: string | null;
  readonly ready_at: string | null;
  readonly failed_at: string | null;
}

export interface Publication {
  readonly project_revision_id: string;
  readonly project_id: string;
  readonly version: number;
  readonly published_at: string;
}

export interface ProjectDraftResponse {
  readonly contract_version: typeof PROJECT_API_CONTRACT_VERSION;
  readonly project: ProjectDraft;
}

export interface PublishedProjectResponse {
  readonly contract_version: typeof PROJECT_API_CONTRACT_VERSION;
  readonly project: PublishedProject;
}

export interface ModelResponse {
  readonly contract_version: typeof PROJECT_API_CONTRACT_VERSION;
  readonly model: ModelSummary;
}

export interface ModelRevisionResponse {
  readonly contract_version: typeof PROJECT_API_CONTRACT_VERSION;
  readonly revision: ModelRevision;
}

export interface PublicationResponse {
  readonly contract_version: typeof PROJECT_API_CONTRACT_VERSION;
  readonly publication: Publication;
}

export interface CursorPageResponse<T> {
  readonly contract_version: typeof PROJECT_API_CONTRACT_VERSION;
  readonly items: readonly T[];
  readonly next_cursor: string | null;
}

export type ProjectListResponse = CursorPageResponse<ProjectSummary>;
export type ModelListResponse = CursorPageResponse<ModelSummary>;
export type ModelRevisionListResponse = CursorPageResponse<ModelRevision>;
