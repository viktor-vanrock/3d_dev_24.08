import type { Request } from "express";
import type { Readable } from "node:stream";
import type { GenerationId, UserId } from "../../_kernel/brandedIds.ts";
import type { RunProgressSnapshot } from "@portal/contracts/http/assistant";
import type { ConceptAngle, GenerationBranch, GenerationRow, GenerationStatus } from "../domain/generations.ts";
import type { OwnedDraftModel } from "../../models/public/index.ts";

export const GENERATIONS_PORT = Symbol("GENERATIONS_PORT");
export const GENERATIONS_EXTERNAL_PORT = Symbol("GENERATIONS_EXTERNAL_PORT");

export interface GenerationObject {
  readonly body: Readable;
  readonly contentLength?: number;
  readonly etag?: string;
}
export interface GenerationsExternalPort {
  storageConfigured(): boolean;
  countPhotos(prefix: string): Promise<number>;
  putObject(key: string, body: Buffer, contentType: string): Promise<boolean>;
  getObject(key: string): Promise<GenerationObject | null>;
  detectImage(body: Buffer): "jpeg" | "png" | "gif" | "webp" | null;
  embed(text: string, timeoutMs?: number): Promise<readonly number[] | null>;
  vectorLiteral(vector: readonly number[]): string;
  modelsStorageConfigured(): boolean;
  copyToModel(input: {
    readonly generationKey: string;
    readonly modelId: string;
    readonly role: string;
  }): Promise<{ readonly s3Key: string; readonly sizeBytes: number; readonly checksum: Buffer } | null>;
  assertDownloadRateLimit(request: Request, userId: UserId): Promise<void>;
  emitStarted(input: {
    readonly generationId: GenerationId;
    readonly userId: UserId;
    readonly branch: string;
    readonly assistantOfferId?: string;
    readonly sourceGenerationId?: string;
  }): Promise<void>;
  emitDownloaded(input: { readonly generationId: GenerationId; readonly userId: UserId; readonly branch: string }): Promise<void>;
}

export interface AssetResult {
  readonly key: string;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly object: GenerationObject;
}
export interface GenerationResponse {
  readonly id: string;
  readonly branch: GenerationBranch;
  readonly prompt: string;
  readonly params: GenerationRow["params"];
  readonly status: GenerationStatus;
  readonly preview_url: string | null;
  readonly artifact_url: string | null;
  readonly preview_shots: readonly { readonly angle: ConceptAngle; readonly url: string }[] | null;
  readonly source_generation_id: string | null;
  readonly source_angles: readonly ConceptAngle[] | null;
  readonly error: string | null;
  readonly error_code: "timeout" | "provider_error" | null;
  readonly retryable: boolean | null;
  readonly progress: RunProgressSnapshot | null;
  readonly delayed: boolean | null;
  readonly queue_position: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
export interface ConceptResponse {
  readonly id: string;
  readonly generation_id: string;
  readonly normalized_query: string;
  readonly label: string;
  readonly prompt: string;
  readonly motif: string | null;
  readonly reuse_count: number;
  readonly status: "queued" | "running" | "ready" | "failed";
  readonly preview_url: string | null;
  readonly score: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}
export interface GenerationOutcome {
  readonly status: number;
  readonly body: { readonly generation: GenerationResponse };
}
export type ConceptGenerationOutcome =
  GenerationOutcome | { readonly status: number; readonly body: { readonly concept: ConceptResponse; readonly generation?: GenerationResponse; readonly cached: boolean } };
export interface CatalogDraftOutcome {
  readonly status: number;
  readonly body: { readonly model: OwnedDraftModel };
}
export interface GenerationHealthResponse {
  readonly window_hours: 24;
  readonly branches: readonly {
    readonly branch: string;
    readonly state: "available" | "degraded" | "down" | "unknown";
    readonly recent_failures: number;
    readonly recent_total: number;
    readonly last_error: string | null;
    readonly last_success_at: string | null;
  }[];
}
export interface GenerationsPort {
  health(): Promise<GenerationHealthResponse>;
  createScan(userId: UserId): { readonly id: string };
  uploadScanPhoto(userId: UserId, scanId: string, file: { readonly buffer: Buffer; readonly truncated?: boolean }): Promise<{ readonly photos: number }>;
  uploadScanManifest(userId: UserId, scanId: string, body: Record<string, unknown>): Promise<{ readonly photos: number }>;
  startScan(userId: UserId, scanId: string, mode: unknown): Promise<GenerationOutcome>;
  detail(userId: UserId, generationId: string): Promise<{ readonly generation: GenerationResponse }>;
  list(userId: UserId): Promise<{ readonly generations: readonly GenerationResponse[] }>;
  listConcepts(query: {
    readonly q?: string;
    readonly limit?: string;
    readonly cursor?: string;
  }): Promise<{ readonly query: string | null; readonly concepts: readonly ConceptResponse[]; readonly next_cursor: string | null; readonly degraded: boolean }>;
  conceptPreview(conceptId: string): Promise<AssetResult>;
  createConcept(userId: UserId, body: Record<string, unknown>, rawIdempotencyKey: unknown): Promise<ConceptGenerationOutcome>;
  catalogDraft(userId: UserId, generationId: string): Promise<CatalogDraftOutcome>;
  generationAsset(userId: UserId, generationId: string, kind: "preview" | "artifact" | "preview_shot", angle: string | undefined, request: Request): Promise<AssetResult>;
  create(userId: UserId, body: Record<string, unknown>, rawIdempotencyKey: unknown): Promise<GenerationOutcome>;
}
export { generationAssetContentType, generationAssetExtension } from "../domain/generations.ts";
export { isPromptBlocked } from "../domain/prompt-moderation.ts";
