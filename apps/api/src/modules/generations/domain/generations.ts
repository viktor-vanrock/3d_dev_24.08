import { createHash } from "node:crypto";
import type { RunProgressSnapshot } from "@portal/contracts/http/assistant";

export const GENERATION_BRANCHES = ["openscad", "kzd", "hueforge", "trellis", "concepts", "scan"] as const;
export type GenerationBranch = (typeof GENERATION_BRANCHES)[number];
export const CONCEPT_ANGLES = ["front", "three_quarter", "back"] as const;
export type ConceptAngle = (typeof CONCEPT_ANGLES)[number];
export const GENERATION_STATUSES = ["queued", "running", "done", "error", "timed_out"] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];
export const PROMPT_MAX_LENGTH = 2_000;
export const PARAMS_MAX_JSON_BYTES = 10 * 1_024;
export const CONCEPT_QUERY_MAX_LENGTH = 300;
export const CONCEPT_LABEL_MAX_LENGTH = 120;
export const CONCEPT_MOTIF_MAX_LENGTH = 120;
export const CONCEPT_LIST_DEFAULT_LIMIT = 12;
export const CONCEPT_LIST_MAX_LIMIT = 24;
export const CONCEPT_LIST_MAX_CURSOR = 4_096;
export const CONCEPT_RENDER_PROFILE = "white-plastic-v1";
export const MIN_SCAN_PHOTOS = 10;
export const MAX_SCAN_PHOTOS = 400;
export const MAX_SCAN_PHOTO_BYTES = 5 * 1_024 * 1_024;

export type GenerationParameterValue = string | number | boolean | null | readonly GenerationParameterValue[] | GenerationParameters;
export interface GenerationParameters {
  readonly [key: string]: GenerationParameterValue;
}

export function isGenerationParameterValue(value: unknown): value is GenerationParameterValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isGenerationParameterValue);
  return typeof value === "object" && Object.values(value).every(isGenerationParameterValue);
}

export function isGenerationParameters(value: unknown): value is GenerationParameters {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(isGenerationParameterValue);
}

export interface GenerationPreviewShot {
  readonly angle: ConceptAngle;
  readonly s3_key: string;
}

export interface GenerationRow {
  readonly id: string;
  readonly user_id: string;
  readonly branch: GenerationBranch;
  readonly prompt: string;
  readonly params: GenerationParameters;
  readonly status: GenerationStatus;
  readonly artifact_url: string | null;
  readonly preview_url: string | null;
  readonly error: string | null;
  readonly assistant_offer_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly phase: string | null;
  readonly progress: number | null;
  readonly eta_seconds: number | null;
  readonly estimate_updated_at: Date | null;
  readonly preview_shots: GenerationPreviewShot[] | null;
  readonly source_generation_id: string | null;
  readonly source_angles: ConceptAngle[] | null;
}

export interface ConceptRow {
  readonly id: string;
  readonly generation_id: string;
  readonly normalized_query: string;
  readonly label: string;
  readonly prompt: string;
  readonly motif: string | null;
  reuse_count: number;
  readonly status: "queued" | "running" | "ready" | "failed";
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly generation_status: string;
  readonly preview_url: string | null;
  readonly score?: number | string | null;
}

export interface HealthRow {
  readonly branch: string;
  readonly status: string;
  readonly error: string | null;
  readonly created_at: Date;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isGenerationBranch(value: unknown): value is GenerationBranch {
  return typeof value === "string" && GENERATION_BRANCHES.includes(value as GenerationBranch);
}
export function isConceptAngle(value: unknown): value is ConceptAngle {
  return typeof value === "string" && CONCEPT_ANGLES.includes(value as ConceptAngle);
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
export function generationQuotaHourly(branch: GenerationBranch): number {
  return branch === "concepts" ? positiveIntEnv("CONCEPT_GENERATION_QUOTA_HOURLY", 240) : positiveIntEnv("GENERATION_QUOTA_HOURLY", 10);
}
export function generationQuotaDaily(branch: GenerationBranch): number {
  return branch === "concepts" ? positiveIntEnv("CONCEPT_GENERATION_QUOTA_DAILY", 1_000) : positiveIntEnv("GENERATION_QUOTA_DAILY", 30);
}
export function staleTimeoutMinutes(): number {
  const value = Number(process.env.GENERATION_STALE_TIMEOUT_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : 15;
}

const BLOCKED_TERMS = [
  "оружи",
  "взрывчат",
  "бомба",
  "бомбу",
  "бомбы",
  "гранат",
  "глушитель для оружия",
  "наркотик",
  "героин",
  "кокаин",
  "метамфетамин",
  "детская порнограф",
  "порнограф",
  "child porn",
  "csam",
  "explosive",
  "firearm",
  "gunpowder",
  "grenade",
  "methamphetamine",
  "heroin",
  "cocaine",
  "porn",
];
export function isPromptBlocked(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const extra = (process.env.GENERATION_BLOCKED_WORDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...BLOCKED_TERMS, ...extra].some((term) => normalized.includes(term));
}

export function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[\x21-\x7E]{1,128}$/.test(value) ? value : null;
}

export function generationRequestFingerprint(
  branch: string,
  prompt: string,
  params: GenerationParameters,
  source: { readonly generationId: string; readonly angles: readonly ConceptAngle[] } | null,
): Buffer {
  return createHash("sha256").update(JSON.stringify({ branch, prompt, params, source })).digest();
}
export function conceptCacheKey(input: { readonly normalizedQuery: string; readonly label: string; readonly prompt: string; readonly motif: string | null }): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([input.normalizedQuery, input.label, input.prompt, input.motif ?? ""]))
    .digest("hex");
  return `${CONCEPT_RENDER_PROFILE}:${digest}`;
}
export function normalizeConceptQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}
export function normalizeOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined;
}

export function generationAssetExtension(key: string): string {
  return key.split(".").pop() ?? "bin";
}
export function generationAssetContentType(key: string): string {
  return (
    ({ stl: "model/stl", png: "image/png", webp: "image/webp", zip: "application/zip", glb: "model/gltf-binary" } as Record<string, string>)[generationAssetExtension(key)] ??
    "application/octet-stream"
  );
}

export function toGenerationResponse(row: GenerationRow, queuePosition: number | null = null) {
  const errorCode: "timeout" | "provider_error" | null =
    row.status === "timed_out" || (row.status === "error" && row.error === "generation_timeout") ? "timeout" : row.status === "error" ? "provider_error" : null;
  const progress: RunProgressSnapshot | null =
    row.status === "running" && row.phase !== null
      ? {
          phase: row.phase as RunProgressSnapshot["phase"],
          progress: row.progress,
          eta_seconds: row.eta_seconds,
          estimate_updated_at: row.estimate_updated_at?.toISOString() ?? null,
        }
      : null;
  const delayed =
    row.status === "queued" || row.status === "running"
      ? row.eta_seconds === null || row.estimate_updated_at === null
        ? null
        : Date.now() > row.estimate_updated_at.getTime() + row.eta_seconds * 1_000
      : null;
  return {
    id: row.id,
    branch: row.branch,
    prompt: row.prompt,
    params: row.params,
    status: row.status,
    preview_url: row.preview_url ? `/generations/${row.id}/preview` : null,
    artifact_url: row.artifact_url ? `/generations/${row.id}/artifact` : null,
    preview_shots: row.preview_shots?.map((shot) => ({ angle: shot.angle, url: `/generations/${row.id}/preview/${shot.angle}` })) ?? null,
    source_generation_id: row.source_generation_id,
    source_angles: row.source_angles,
    error: row.error,
    error_code: errorCode,
    retryable: errorCode === null ? null : errorCode === "timeout",
    progress,
    delayed,
    queue_position: queuePosition,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toConceptCard(row: ConceptRow) {
  const ready = row.status === "ready" && row.generation_status === "done" && Boolean(row.preview_url);
  return {
    id: row.id,
    generation_id: row.generation_id,
    normalized_query: row.normalized_query,
    label: row.label,
    prompt: row.prompt,
    motif: row.motif,
    reuse_count: Number(row.reuse_count),
    status: ready ? "ready" : row.status,
    preview_url: ready ? `/concepts/${row.id}/preview` : null,
    score: row.score == null ? null : Number(row.score),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export type BranchState = "available" | "degraded" | "down" | "unknown";
export function branchHealth(branch: string, rows: readonly HealthRow[]) {
  const recent = rows.filter((row) => row.branch === branch).slice(0, 5);
  const failures = recent.filter((row) => row.status === "error" || row.status === "timed_out");
  const lastSuccess = rows.find((row) => row.branch === branch && row.status === "done");
  const state: BranchState = recent.length === 0 ? "unknown" : failures.length === recent.length ? "down" : failures.length > 0 ? "degraded" : "available";
  return {
    branch,
    state,
    recent_failures: failures.length,
    recent_total: recent.length,
    last_error: failures[0]?.error ?? null,
    last_success_at: lastSuccess?.created_at.toISOString() ?? null,
  };
}

export function scanPhotoPrefix(userId: string, scanId: string): string {
  return `scans/${userId}/${scanId}/`;
}
