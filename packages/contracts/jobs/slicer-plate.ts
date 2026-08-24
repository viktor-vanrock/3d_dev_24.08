import { createHash } from "node:crypto";
import type { SliceTrustMaterial } from "./slicer.js";

// Шов `jobs`: API (apps/api/src/models/slicing.route.ts, продюсер) → Mesh (headless-слайсер,
// консюмер — не реализуется этой карточкой, MF-1986). `project-slice-request.v1` — аддитивное
// расширение `POST /models/:id/slice` (slicer.ts/`CreateSliceJobRequest` не трогается): вместо
// плоского {profile_id, scale} принимает per-instance pinned project-as-code identity
// (project-code.v1, packages/contracts/http/models.ts) вместе с раскладкой стола (PlateLayout).
// Старый плоский путь остаётся рабочим без изменений — `layout`/`intent` optional. `slice-trust.v1`
// (slicer.ts) — независимая ось, коды не пересекаются. Решение: комментарий Contract Architect на
// MF-1981, docs/design/slicer.editor.md §3.2/§4.3/§7/§11, docs/architecture/data.fragmentation.md §1.

export const PROJECT_SLICE_REQUEST_CONTRACT_VERSION = "project-slice-request.v1" as const;

export interface ProjectSliceRequestV1QueueJob {
  readonly queue: typeof PROJECT_SLICE_REQUEST_CONTRACT_VERSION;
  readonly jobId: string;
  readonly modelId: string;
  readonly profileId: string;
  readonly filamentProfileId: string | null;
  readonly scale: number;
  readonly requestedBy: string;
  readonly accountId: string;
  readonly deviceId: string | null;
  readonly sliceKey: Uint8Array;
  readonly trust: {
    readonly material: SliceTrustMaterial;
    readonly keyId: string;
    readonly signature: string;
  };
  readonly layout: PlateLayout;
  readonly intent: SliceIntent;
  readonly preflight: PlatePreflightResult;
}

export class PlateContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlateContractError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HEX_256_RE = /^[a-f0-9]{64}$/;
/** Составные ключи манифеста project-code.v1 — kebab-case (project.manifest.md §2). */
const MANIFEST_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
/** PlateInstance.instance_id/layout_snapshot_id — client-side opaque token, шире манифест-id. */
const OPAQUE_TOKEN_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---------------------------------------------------------------------------------------------
// source identity (решение MF-1981 "Контракт": server резолвит pinned artifact сам)
// ---------------------------------------------------------------------------------------------

/**
 * Явная граница v1 (см. header): `model_id` обязан равняться `POST /models/:id/slice`-у `:id` —
 * проверяется на API-слое (SOURCE_MODEL_MISMATCH), не этой структурной функцией.
 */
export interface ProjectSliceSource {
  model_id: string;
  /** Commit SHA манифеста в git (project_revisions.commit_sha), не ref/branch. */
  revision: string;
  configuration_id: string;
  /** sha256 резолвленной конфигурации — hex, тот же формат, что project_revisions.configuration_digest. */
  configuration_digest: string;
  workflow_step_id: string;
  artifact_id: string;
  /** Заявленный клиентом sha256 — сервер пересчитывает и сверяет (SOURCE_ARTIFACT_MISMATCH при расхождении). */
  artifact_sha256: string;
  build_session_id?: string | null;
}

export function isProjectSliceSource(value: unknown): value is ProjectSliceSource {
  if (!isRecord(value)) return false;
  if (typeof value.model_id !== "string" || !UUID_RE.test(value.model_id)) return false;
  if (typeof value.revision !== "string" || !COMMIT_SHA_RE.test(value.revision)) return false;
  if (typeof value.configuration_id !== "string" || !MANIFEST_ID_RE.test(value.configuration_id)) return false;
  if (typeof value.configuration_digest !== "string" || !HEX_256_RE.test(value.configuration_digest)) return false;
  if (typeof value.workflow_step_id !== "string" || !MANIFEST_ID_RE.test(value.workflow_step_id)) return false;
  if (typeof value.artifact_id !== "string" || !MANIFEST_ID_RE.test(value.artifact_id)) return false;
  if (typeof value.artifact_sha256 !== "string" || !HEX_256_RE.test(value.artifact_sha256)) return false;
  if (value.build_session_id !== undefined && value.build_session_id !== null) {
    if (typeof value.build_session_id !== "string" || !UUID_RE.test(value.build_session_id)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// bed geometry (docs/design/slicer.editor.md §3.2)
// ---------------------------------------------------------------------------------------------

export const BED_SHAPES = ["rect", "circle", "polygon"] as const;
export type BedShape = (typeof BED_SHAPES)[number];
export const BED_ORIGINS = ["center", "front_left", "explicit"] as const;
export type BedOrigin = (typeof BED_ORIGINS)[number];

export interface BedExcludedZone {
  x_mm: number;
  y_mm: number;
  width_mm: number;
  depth_mm: number;
}

export interface BedGeometry {
  shape: BedShape;
  width_mm?: number;
  depth_mm?: number;
  diameter_mm?: number;
  points_mm?: ReadonlyArray<readonly [number, number]>;
  origin: BedOrigin;
  excluded_zones_mm?: BedExcludedZone[];
}

function isExcludedZone(value: unknown): value is BedExcludedZone {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.x_mm) && isFiniteNumber(value.y_mm)
    && isFiniteNumber(value.width_mm) && value.width_mm > 0
    && isFiniteNumber(value.depth_mm) && value.depth_mm > 0;
}

export function isBedGeometry(value: unknown): value is BedGeometry {
  if (!isRecord(value)) return false;
  if (typeof value.shape !== "string" || !(BED_SHAPES as readonly string[]).includes(value.shape)) return false;
  if (typeof value.origin !== "string" || !(BED_ORIGINS as readonly string[]).includes(value.origin)) return false;
  if (value.shape === "rect") {
    if (!isFiniteNumber(value.width_mm) || value.width_mm <= 0) return false;
    if (!isFiniteNumber(value.depth_mm) || value.depth_mm <= 0) return false;
  } else if (value.shape === "circle") {
    if (!isFiniteNumber(value.diameter_mm) || value.diameter_mm <= 0) return false;
  } else {
    if (!Array.isArray(value.points_mm) || value.points_mm.length < 3) return false;
    for (const point of value.points_mm) {
      if (!Array.isArray(point) || point.length !== 2 || !isFiniteNumber(point[0]) || !isFiniteNumber(point[1])) return false;
    }
  }
  if (value.excluded_zones_mm !== undefined) {
    if (!Array.isArray(value.excluded_zones_mm) || !value.excluded_zones_mm.every(isExcludedZone)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// layout / instances (§4, §11 "Минимальный новый payload")
// ---------------------------------------------------------------------------------------------

export interface PlateInstance {
  instance_id: string;
  source: ProjectSliceSource;
  x_mm: number;
  y_mm: number;
  rotation_z_deg: number;
  scale: number;
}

export interface PlateLayout {
  bed_geometry: BedGeometry;
  instances: PlateInstance[];
  /** Client-side корреляция для reload — НЕ участвует в идемпотентности (та — на slice_key). */
  layout_snapshot_id: string;
}

export function isPlateInstance(value: unknown): value is PlateInstance {
  if (!isRecord(value)) return false;
  if (typeof value.instance_id !== "string" || !OPAQUE_TOKEN_RE.test(value.instance_id)) return false;
  if (!isProjectSliceSource(value.source)) return false;
  if (!isFiniteNumber(value.x_mm) || !isFiniteNumber(value.y_mm) || !isFiniteNumber(value.rotation_z_deg)) return false;
  if (!isFiniteNumber(value.scale) || value.scale <= 0) return false;
  return true;
}

export function isPlateLayout(value: unknown): value is PlateLayout {
  if (!isRecord(value)) return false;
  if (!isBedGeometry(value.bed_geometry)) return false;
  if (typeof value.layout_snapshot_id !== "string" || !OPAQUE_TOKEN_RE.test(value.layout_snapshot_id)) return false;
  if (!Array.isArray(value.instances) || value.instances.length === 0) return false;
  if (!value.instances.every(isPlateInstance)) return false;
  const ids = new Set<string>();
  for (const instance of value.instances as PlateInstance[]) {
    if (ids.has(instance.instance_id)) return false;
    ids.add(instance.instance_id);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// intent (§11: quality — тот же словарь, что GET /slicer-profiles/:printerId/:filamentId)
// ---------------------------------------------------------------------------------------------

export const SLICE_QUALITY_VALUES = ["strength", "speed", "appearance", "miniatures"] as const;
export type SliceQuality = (typeof SLICE_QUALITY_VALUES)[number];
export const SLICE_SUPPORTS_VALUES = ["auto", "tree", "off"] as const;
export type SliceSupportsMode = (typeof SLICE_SUPPORTS_VALUES)[number];

export interface SliceIntent {
  /** Только аудит-метка — НЕ переопределяет уже резолвленный profile_id (решение MF-1981). */
  quality?: SliceQuality;
  supports: SliceSupportsMode;
}

export function isSliceIntent(value: unknown): value is SliceIntent {
  if (!isRecord(value)) return false;
  if (value.quality !== undefined && !(SLICE_QUALITY_VALUES as readonly string[]).includes(value.quality as string)) return false;
  if (typeof value.supports !== "string" || !(SLICE_SUPPORTS_VALUES as readonly string[]).includes(value.supports)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// errors (решение MF-1981 — UPPER_SNAKE_CASE, тот же регистр что slice-trust.v1)
// ---------------------------------------------------------------------------------------------

export const PROJECT_SLICE_ERROR_CODES = [
  "SOURCE_NOT_FOUND",
  "SOURCE_ARTIFACT_MISMATCH",
  "SOURCE_ROLE_UNSUPPORTED",
  "SOURCE_MODEL_MISMATCH",
  "BED_GEOMETRY_UNCONFIRMED",
  "LAYOUT_INVALID",
  "LAYOUT_PREFLIGHT_FAILED",
  "UNSUPPORTED_TOOLHEAD",
] as const;
export type ProjectSliceErrorCode = (typeof PROJECT_SLICE_ERROR_CODES)[number];

// ---------------------------------------------------------------------------------------------
// preflight (docs/design/slicer.editor.md §4.3/§11 п.3 — per-instance codes, не один boolean)
// ---------------------------------------------------------------------------------------------

export const PLATE_PREFLIGHT_CODES = [
  "collision",
  "outside_bed",
  "height_exceeded",
  "clearance_failed",
  "unsupported_geometry",
] as const;
export type PlatePreflightCode = (typeof PLATE_PREFLIGHT_CODES)[number];

export interface PlateInstancePreflight {
  instance_id: string;
  ok: boolean;
  codes: PlatePreflightCode[];
  /** Только при code=collision — id других инстансов, с которыми пересекается footprint. */
  collides_with?: string[];
}

export interface PlatePreflightResult {
  ok: boolean;
  instances: PlateInstancePreflight[];
}

// ---------------------------------------------------------------------------------------------
// layout_digest / slice_key (data.fragmentation.md §1: model_hash → layout_digest в layout-пути)
// ---------------------------------------------------------------------------------------------

/**
 * Canonical JSON строго по решению MF-1981: `{bed_geometry, instances без instance_id, intent}`,
 * ключи объектов лексикографически. `instance_id` — client-side label, исключён намеренно (g-code
 * не зависит от того, как клиент назвал копию). Порядок массива `instances` значим (переставленные
 * местами, но иначе идентичные инстансы физически другая раскладка на столе слайсера не всегда,
 * но эта функция не пытается канонизировать перестановки — тот же принцип "сервер не угадывает
 * геометрию", что и в остальном контракте).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

export function canonicalizePlateLayoutForDigest(layout: PlateLayout, intent: SliceIntent): string {
  const instances = layout.instances.map(({ instance_id: _instance_id, ...rest }) => rest);
  return JSON.stringify(sortKeysDeep({ bed_geometry: layout.bed_geometry, instances, intent }));
}

/** sha256 hex канонической раскладки+intent — заменяет `model_hash` в старой формуле §1. */
export function computeLayoutDigest(layout: PlateLayout, intent: SliceIntent): string {
  return createHash("sha256").update(canonicalizePlateLayoutForDigest(layout, intent), "utf8").digest("hex");
}

/**
 * Финальный dedup-ключ job'а под layout-путём: `hash(layout_digest · trust_slice_key)`.
 * `trust_slice_key` (slice-trust.v1, уже часть запроса — независимая ось) несёт свою половину
 * формулы (`profile_hash · config_fingerprint`, MF-1688) — эта функция комбинирует её с
 * server-computed `layout_digest` вместо client-declared `model_hash`. Идемпотентность — на этом
 * значении, не на `layout_snapshot_id` (тот только client-side корреляция для reload).
 */
export function computePlateSliceKey(layoutDigestHex: string, trustSliceKeyHex: string): string {
  if (!HEX_256_RE.test(layoutDigestHex)) throw new PlateContractError("layoutDigestHex must be lower-case sha256 hex");
  if (!/^[a-f0-9]{64,}$/.test(trustSliceKeyHex)) throw new PlateContractError("trustSliceKeyHex must be lower-case hex");
  return createHash("sha256").update(`${layoutDigestHex}:${trustSliceKeyHex}`, "utf8").digest("hex");
}
