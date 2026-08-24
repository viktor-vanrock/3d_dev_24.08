import type { QueryResult, QueryResultRow } from "pg";
import type { SliceTrustMaterial } from "@portal/contracts/jobs/slicer";
import type { ModelId, UserId } from "../../_kernel/brandedIds.ts";

export const MODEL_READ_PORT = Symbol("MODEL_READ_PORT");
export const MODEL_MAKES_PORT = Symbol("MODEL_MAKES_PORT");
export const MODEL_OWNER_PORT = Symbol("MODEL_OWNER_PORT");

export interface ModelQueryExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

export interface OwnedDraftModel {
  readonly id: string;
  readonly title: string;
  readonly source_format: string;
  readonly status: string;
  readonly craft: string;
}

export interface CreateGenerationDraftInput {
  readonly ownerId: string;
  readonly title: string;
  readonly sourceFormat: "stl" | "zip";
  readonly sourceGenerationId: string;
}

export interface CreateImportedModelInput {
  readonly ownerId: string;
  readonly title: string;
  readonly description: string | null;
  readonly sourceFormat: string;
}

export interface UpdateImportedModelInput {
  readonly modelId: string;
  readonly title: string;
  readonly description: string | null;
  readonly sourceFormat: string;
}

export interface AddModelFileInput {
  readonly modelId: string;
  readonly role: string;
  readonly s3Key: string | null;
  readonly sizeBytes: number;
  readonly checksum: Buffer;
  readonly originalFilename?: string | null;
  readonly mimeType?: string | null;
}

export interface ModelOwnerPort {
  findGenerationDraft(sourceGenerationId: string, executor?: ModelQueryExecutor): Promise<OwnedDraftModel | null>;
  createGenerationDraft(executor: ModelQueryExecutor, input: CreateGenerationDraftInput): Promise<string>;
  createImportedModel(executor: ModelQueryExecutor, input: CreateImportedModelInput): Promise<string>;
  updateImportedModel(executor: ModelQueryExecutor, input: UpdateImportedModelInput): Promise<void>;
  deleteModelFiles(modelId: string, roles: readonly string[], executor?: ModelQueryExecutor): Promise<void>;
  addModelFile(input: AddModelFileInput, executor?: ModelQueryExecutor): Promise<void>;
  deleteModel(modelId: string, executor?: ModelQueryExecutor): Promise<void>;
  replaceModelTags(modelId: string, tagIds: readonly string[], executor?: ModelQueryExecutor): Promise<void>;
  clearModelTags(modelId: string, executor?: ModelQueryExecutor): Promise<void>;
  addModelTags(modelId: string, tagIds: readonly string[], executor?: ModelQueryExecutor): Promise<void>;
  setRepoPath(modelId: string, repoPath: string, executor?: ModelQueryExecutor): Promise<void>;
}

export interface PublicModelSeo {
  readonly id: ModelId;
  readonly ownerId: UserId;
  readonly title: string;
  readonly description: string | null;
  readonly hasThumbnail: boolean;
}

export interface SitemapModel {
  readonly id: ModelId;
  readonly updatedAt: Date;
}

export interface SitemapOwnerActivity {
  readonly ownerId: UserId;
  readonly lastUpdatedAt: Date;
}

export interface BillingModelSnapshot {
  readonly id: ModelId;
  readonly ownerId: UserId;
  readonly title: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly publishStatus: string;
}

export type ModelSliceDispatchResult =
  | { readonly kind: "missing" }
  | { readonly kind: "not_ready" }
  | { readonly kind: "untrusted" }
  | {
      readonly kind: "ready";
      readonly job: {
        readonly id: string;
        readonly device_id: string | null;
        readonly gcode_s3_key: string;
        readonly slice_trust_material: SliceTrustMaterial & { readonly config_fingerprint: string };
      };
    };

export interface ModelReadPort {
  exists(modelId: ModelId): Promise<boolean>;
  boundingBox(modelId: ModelId): Promise<{ readonly x: number; readonly y: number; readonly z: number } | null>;
  findReadySeo(modelId: ModelId): Promise<PublicModelSeo | null>;
  readyThumbnailKey(modelId: ModelId): Promise<string | null>;
  readySitemapModels(): Promise<readonly SitemapModel[]>;
  readySitemapOwners(): Promise<readonly SitemapOwnerActivity[]>;
  countReadyByOwner(userId: UserId): Promise<number>;
  readyIdsByOwner(userId: UserId): Promise<readonly ModelId[]>;
  sumReadyDownloadsByOwner(userId: UserId): Promise<number>;
  findBillingModels(modelIds: readonly ModelId[]): Promise<ReadonlyMap<ModelId, BillingModelSnapshot>>;
  searchPublished(query: string, limit: number): Promise<readonly { readonly id: ModelId; readonly title: string }[]>;
  loadDispatchableSlice(sliceJobId: string, actorId: UserId): Promise<ModelSliceDispatchResult>;
  boundingBoxByInternalModelId(modelId: string): Promise<{ readonly x: number; readonly y: number; readonly z: number } | null>;
  tagIdsForModels(modelIds: readonly ModelId[]): Promise<readonly string[]>;
  modelIdsWithAnyTags(modelIds: readonly ModelId[], tagIds: readonly string[]): Promise<ReadonlySet<ModelId>>;
}

export interface ModelMakeSummary {
  readonly id: ModelId;
  readonly ownerId: UserId;
  readonly title: string;
}

export interface ModelMakesPort {
  find(modelId: ModelId): Promise<ModelMakeSummary | null>;
  findMany(modelIds: readonly ModelId[]): Promise<ReadonlyMap<ModelId, ModelMakeSummary>>;
  incrementMakesCount(modelId: ModelId): Promise<void>;
  modelIdsForTagId(tagId: string): Promise<readonly ModelId[]>;
}

export {
  DEFAULT_MARGIN_MM,
  compatCheck,
  fitsBuildVolume,
  type CompatFilamentInput,
  type CompatModelInput,
  type CompatPrinterInput,
  type CompatReason,
  type FillType,
} from "../domain/compatibility.ts";
export type { ManufacturingMethod } from "../infrastructure/manufacturing.ts";

export { MAX_DESCRIPTION_IMAGE_BYTES } from "../infrastructure/descriptionimage.ts";
export { detectImageFormat } from "../infrastructure/descriptionimage.ts";
export { embedSearchQuery, toPgVectorLiteral } from "../infrastructure/searchEmbedClient.ts";
export { modelIdsWithThumbnails, thumbAssetUrl } from "../infrastructure/assets.ts";
export { UNVERIFIED_IMPORT_EXISTS_SQL_COMPAT, isVisibleToNonOwner } from "../../importConnections/public/index.ts";
export { InvalidRepoUrlError, validateRepoUrl } from "../infrastructure/repo-url.ts";
export { craftForRole, DecompressionLimitError, detectAndValidateFormat, FormatMismatchError, UnsupportedFormatError } from "../infrastructure/formats.ts";
export {
  addOwnedModelFile,
  childModelIdForOwnedProject,
  createOwnedImportedModel,
  deleteOwnedModelFiles,
  projectIdForOwnedChildModel,
  syncOwnedModelTags,
  updateOwnedImportedModel,
} from "../infrastructure/model-owner.ts";
