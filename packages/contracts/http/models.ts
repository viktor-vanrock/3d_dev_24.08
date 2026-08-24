// Шов `apps/api/src/models` (+ `git`) → `apps/web/src/market`. Владелец домена — Back (models.ts,
// git.ts); Front — консюмер (заменяет локальные типы apps/web/src/market/models.types.ts). Нормативный
// прозаический канон — docs/architecture/project.manifest.md (MF-1963); это его буквальное TS-зеркало.
// JSON Schema резолвленного манифеста: ./project.manifest.v1.schema.json ($id
// https://schemas.3mf.tech/project/v1) — эти типы ОБЯЗАНЫ оставаться в форме, эквивалентной ей
// (kebab-case составных ключей, id-keyed maps, array-кортежи translation/rotation); расхождение —
// баг контракта. Решение, error-таксономия, идемпотентность, наблюдаемость и migration path:
// docs/contracts/project.code.v1.md. Никакой бизнес-логики в этом файле (canonicalize/digest ниже —
// чистая детерминированная функция над уже резолвленными данными, тот же класс, что
// `isUnitQuaternion`/`hasDuplicateIds`, не business-правило).

import { createHash } from "node:crypto";

export const PROJECT_CODE_CONTRACT_VERSION = "project-code.v1" as const;
export const PROJECT_MANIFEST_SCHEMA_URL = "https://schemas.3mf.tech/project/v1" as const;

// ---------------------------------------------------------------------------------------------
// Примитивы (project.manifest.md §2–3)
// ---------------------------------------------------------------------------------------------

/** `[a-z0-9][a-z0-9.-]{0,63}` — стабильный, не зависит от файла/позиции/переиспользования. */
export type ManifestId = string;

export type CoordinateSystem = "right-handed-z-up";
export type LengthUnit = "mm";

/** `[x, y, z]` в мм. */
export type Vector3Mm = readonly [number, number, number];
/** `[x, y, z, w]` — единичный кватернион; углы Эйлера запрещены. */
export type Quaternion = readonly [number, number, number, number];

export interface ManifestTransform {
  translation: Vector3Mm;
  rotation: Quaternion;
  /** default `[1, 1, 1]`. */
  scale?: Vector3Mm;
}

/**
 * `Record<Id, T>`. Ключи — исключительно `Id` (никаких `x-*` внутри контейнера): namespaced
 * расширения — поля ВНУТРИ каждой записи (Project/Artifact/Component/…), не соседние
 * псевдо-записи в id-keyed map (project.manifest.md: «x-* поля разрешены… по всему дереву»
 * читается как «в каждом узле дерева», не как «вместо ключа-id»).
 */
export type IdMap<T> = Record<string, T>;

// ---------------------------------------------------------------------------------------------
// project
// ---------------------------------------------------------------------------------------------

export interface ManifestProjectAuthor {
  name: string;
  url?: string | null;
}

export interface ManifestProjectUpstream {
  url: string;
  ref?: string | null;
  commit?: string | null;
}

export interface ManifestProjectRelease {
  version: string;
  notes?: string | null;
}

export interface ManifestProject {
  uid: ManifestId;
  title: string;
  /** Обязана резолвиться в ключ `configurations`. */
  "default-configuration": ManifestId;
  units: { length: LengthUnit; coordinates: CoordinateSystem };
  license?: { spdx?: string; file?: string } | null;
  authors?: ManifestProjectAuthor[];
  upstream?: ManifestProjectUpstream | null;
  release?: ManifestProjectRelease | null;
  "safety-notices"?: string[];
}

// ---------------------------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------------------------

/**
 * Адресует: обычный файл по `path`, object/build-item внутри контейнера (`selector`), внешний
 * immutable ресурс (`url`+`sha256`, allowlist проверяет резолвер, не эта форма) — не байты в
 * манифесте. `kind` — свободный семантический slug (напр. `print-model`), не закрытый enum в v1.
 */
export interface ManifestArtifact {
  path?: string;
  url?: string;
  kind: string;
  selector?: string | null;
  sha256?: string | null;
  "media-type"?: string | null;
  role?: string | null;
  provenance?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------------------------
// components / interfaces
// ---------------------------------------------------------------------------------------------

export type ComponentKind = "manufactured" | "purchased" | "software" | "consumable" | "tool";
export type InterfaceKind = "point" | "axis" | "plane" | "holes" | "connector" | "electrical" | "software";

export interface ManifestInterface {
  kind: InterfaceKind;
  transform: ManifestTransform;
}

export interface ManifestComponent {
  kind: ComponentKind;
  /** Ref в `artifacts` — типично для `kind: manufactured`. */
  artifact?: ManifestId | null;
  /** Каталожный id — типично для `kind: purchased`. Manifest не хранит цену как вечную истину. */
  "catalog-ref"?: string | null;
  interfaces?: IdMap<ManifestInterface>;
}

// ---------------------------------------------------------------------------------------------
// configurations: requirements / compatibility / BOM
// ---------------------------------------------------------------------------------------------

export type CompatibilityStatus = "compatible" | "incompatible" | "unknown";
/** `unknown` — валидное и видимое значение (project.manifest.md §5.7), не «нет данных». */
export type CompatibilityConfidence = "high" | "medium" | "low" | "unknown";
export type CompatibilityProvenance = "author" | "manufacturer" | "verified_make" | "agent" | "computed";

export interface CompatibilityClaim {
  subject: string;
  value: unknown;
  status: CompatibilityStatus;
  provenance: CompatibilityProvenance;
  confidence: CompatibilityConfidence;
}

export interface ManifestBomEntry {
  component?: ManifestId | null;
  quantity: number;
  unit?: string | null;
  source: "printed" | "purchased" | "salvaged";
  notes?: string | null;
}

export interface ManifestConfiguration {
  title: string;
  artifacts?: ManifestId[];
  components?: ManifestId[];
  /** Ref в `workflows`. */
  workflow: ManifestId;
  requirements?: { machines?: string[]; materials?: string[]; skills?: string[] };
  compatibility?: CompatibilityClaim[];
  bom?: ManifestBomEntry[];
}

// ---------------------------------------------------------------------------------------------
// scenes / connections
// ---------------------------------------------------------------------------------------------

export interface ManifestInstance {
  component: ManifestId;
  transform: ManifestTransform;
}

export interface ManifestScene {
  instances: IdMap<ManifestInstance>;
  "active-connections"?: ManifestId[];
}

export type ConnectionKind =
  | "fixed"
  | "fastener"
  | "press-fit"
  | "snap"
  | "adhesive"
  | "hinge"
  | "slider"
  | "alignment"
  | "wire"
  | "connector"
  | "solder"
  | "software";

export interface ManifestConnectionEndpoint {
  instance: ManifestId;
  interface?: ManifestId | null;
}

export interface ManifestConnection {
  kind: ConnectionKind;
  /** 2 или более. */
  endpoints: ManifestConnectionEndpoint[];
  /** Открытый bag (fastener/quantity/tool/допуски/safety note) — форма не закрыта v1. */
  parameters?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// workflows: phases / steps
// ---------------------------------------------------------------------------------------------

export const PHASE_TYPES = ["print", "assembly", "flash", "solder", "check"] as const;
export type PhaseType = (typeof PHASE_TYPES)[number];

export interface ManifestPhase {
  type: PhaseType;
  "depends-on"?: ManifestId[];
  steps: ManifestId[];
}

export interface ManifestTransition {
  "from-scene"?: ManifestId | null;
  "to-scene"?: ManifestId | null;
  "add-connections"?: ManifestId[];
  "remove-connections"?: ManifestId[];
}

/** Typed intent, НЕ shell-команда (§5.8). `type` — открытый slug, API отдельно авторизует capability. */
export interface ManifestAction {
  type: string;
  [param: string]: unknown;
}

export const EVIDENCE_KINDS = ["confirmation", "photo", "measurement", "machine_result"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface ManifestEvidencePolicy {
  accepted: EvidenceKind[];
}

export interface ManifestStep {
  title: string;
  instruction?: string | null;
  inputs?: unknown[];
  outputs?: unknown[];
  requirements?: unknown[];
  warnings?: string[];
  transition?: ManifestTransition;
  action?: ManifestAction;
  evidence?: ManifestEvidencePolicy;
  "allow-skip"?: boolean;
  "skip-reason"?: string | null;
  /** Другие step id ЭТОГО workflow — резолвер отклоняет цикл (`project_workflow_cycle`). */
  "depends-on"?: ManifestId[];
}

export interface ManifestWorkflow {
  phases: IdMap<ManifestPhase>;
  steps: IdMap<ManifestStep>;
}

// ---------------------------------------------------------------------------------------------
// Резолвленный проектный граф верхнего уровня
// ---------------------------------------------------------------------------------------------

interface ResolvedProjectGraphCore {
  schema: typeof PROJECT_MANIFEST_SCHEMA_URL;
  project: ManifestProject;
  artifacts?: IdMap<ManifestArtifact>;
  components?: IdMap<ManifestComponent>;
  configurations?: IdMap<ManifestConfiguration>;
  scenes?: IdMap<ManifestScene>;
  connections?: IdMap<ManifestConnection>;
  workflows?: IdMap<ManifestWorkflow>;
}

/**
 * Форма ОБЯЗАНА оставаться структурно идентичной project.manifest.v1.schema.json: namespaced
 * `x-*` ключи остаются плоскими siblings на своём уровне дерева (project.manifest.md: «x-* поля
 * разрешены и сохраняются по всему дереву»), не сворачиваются в отдельный `extensions`-объект.
 */
export type ResolvedProjectGraph = ResolvedProjectGraphCore & { [key: `x-${string}`]: unknown };

const RESOLVED_PROJECT_GRAPH_CORE_KEYS = [
  "schema",
  "project",
  "artifacts",
  "components",
  "configurations",
  "scenes",
  "connections",
  "workflows",
] as const;

// ---------------------------------------------------------------------------------------------
// Диагностика парсинга/валидации — точный формат из project.manifest.md §12
// ---------------------------------------------------------------------------------------------

export type ManifestDiagnosticSeverity = "error" | "warning";

export const MANIFEST_DIAGNOSTIC_CODES = [
  "project_schema_unsupported",
  "project_yaml_unsafe",
  "project_duplicate_id",
  "project_reference_missing",
  "project_path_unsafe",
  "project_artifact_missing",
  "project_transform_invalid",
  "project_connection_invalid",
  "project_workflow_cycle",
  "project_scene_unreachable",
  "project_head_conflict",
  "project_import_untrusted_source",
  "project_import_limit_exceeded",
  "project_secret_detected",
] as const;
export type ManifestDiagnosticCode = (typeof MANIFEST_DIAGNOSTIC_CODES)[number];

/**
 * `json_path` — путь внутри резолвленного графа (напр. `configurations.pla-sg90.bom[2].quantity`),
 * `yaml_line`/`yaml_column` — 1-based позиция в исходном YAML, отсутствуют если ошибка кросс-полевая
 * (напр. `project_reference_missing`) и не привязана к одной точке текста.
 */
export interface ManifestDiagnostic {
  code: ManifestDiagnosticCode;
  severity: ManifestDiagnosticSeverity;
  json_path: string;
  yaml_line?: number | null;
  yaml_column?: number | null;
  entity_id?: string | null;
  message: string;
  hint?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Storage class — куда физически попадает файл проекта (project.manifest.md §10)
// ---------------------------------------------------------------------------------------------

/**
 * `git` — manifest/README/user source files. `s3-derived` — регенерируемые GLB/WebP/canonical
 * outputs. `s3-description` — единственное неregenerируемое исключение вне git (description_image).
 */
export type ProjectStorageClass = "git" | "s3-derived" | "s3-description";

// ---------------------------------------------------------------------------------------------
// Models/editor API — read/write манифеста (CAS через base_head_sha, project.manifest.md §7)
// ---------------------------------------------------------------------------------------------

export interface GetProjectManifestResult {
  contract_version: typeof PROJECT_CODE_CONTRACT_VERSION;
  /** Git commit sha манифеста на момент чтения — передаётся обратно как base_head_sha при записи. */
  head_sha: string;
  /** sha256 канонического JSON резолвленного графа (project.manifest.md §6: manifest_digest). */
  manifest_digest: string;
  /** digest выбранной конфигурации (§6) — обычно project.default-configuration, если Front её не сменил. */
  configuration_digest: string | null;
  manifest: ResolvedProjectGraph;
  /** Диагностика последнего резолва (warnings не блокируют чтение; errors → manifest = last-known-good). */
  diagnostics: ManifestDiagnostic[];
}

export interface PutProjectManifestRequest {
  contract_version: typeof PROJECT_CODE_CONTRACT_VERSION;
  /** head_sha, с которым редактор начал правку (project.manifest.md §7: `base_head_sha`). */
  base_head_sha: string;
  /** Полная разрешённая authoring-модель (API сериализует YAML и владеет форматированием). */
  manifest: ResolvedProjectGraph;
  commit_message: string;
}

export interface PutProjectManifestResult {
  contract_version: typeof PROJECT_CODE_CONTRACT_VERSION;
  head_sha: string;
  manifest_digest: string;
  configuration_digest: string | null;
  diagnostics: ManifestDiagnostic[];
}

export const PROJECT_MANIFEST_ERROR_CODES = [
  "project_manifest_invalid",
  "project_head_conflict",
  "project_schema_unsupported",
  "project_not_found",
  "project_forbidden",
] as const;
export type ProjectManifestErrorCode = (typeof PROJECT_MANIFEST_ERROR_CODES)[number];

/**
 * `project_head_conflict` — CAS-провал: `base_head_sha !== текущий head`. Не перезаписывает git;
 * возвращает актуальный `head_sha`, чтобы редактор мог перечитать/смёржить, не теряя правку юзера
 * (last-known-good проекция никогда не затирается ошибочной записью — project.manifest.md §7).
 */
export interface ProjectManifestError {
  error: ProjectManifestErrorCode;
  current_head_sha: string | null;
  diagnostics: ManifestDiagnostic[];
}

// ---------------------------------------------------------------------------------------------
// Публичные bounded git-reads (tree/readme/history) — без author_email, для гостя (MF-1965)
// ---------------------------------------------------------------------------------------------

export const REPO_READ_PAGE_LIMIT = 100;

export interface PublicRepoTreeEntry {
  path: string;
  size_bytes: number | null;
}

export interface PublicRepoTreeResult {
  source: "git" | "fallback";
  head_sha: string | null;
  entries: PublicRepoTreeEntry[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface PublicRepoReadmeResult {
  source: "git" | "fallback";
  head_sha: string | null;
  content_markdown: string;
}

/** Как RepoHistoryCommit (apps/web/src/market/models.types.ts), но БЕЗ author_email — публичный шов. */
export interface PublicRepoHistoryCommit {
  sha: string;
  author_name: string;
  authored_at: string;
  subject: string;
}

export interface PublicRepoHistoryResult {
  source: "git" | "fallback";
  commits: PublicRepoHistoryCommit[];
  has_more: boolean;
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------------------------
// Guards и pure-хелперы (без бизнес-логики; YAML-парсинг/git-доступ остаются у Back)
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const X_KEY_PATTERN = /^x-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isManifestId(value: unknown): value is ManifestId {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Structural guard резолвленного графа верхнего уровня — НЕ полноценный JSON Schema validator. */
export function isResolvedProjectGraph(value: unknown): value is ResolvedProjectGraph {
  if (!isRecord(value)) return false;
  if (value.schema !== PROJECT_MANIFEST_SCHEMA_URL) return false;
  if (!isRecord(value.project)) return false;
  for (const collection of ["artifacts", "components", "configurations", "scenes", "connections", "workflows"] as const) {
    if (value[collection] !== undefined && !isRecord(value[collection])) return false;
  }
  // Единственные допустимые ключи вне core-набора — namespaced `x-*`.
  return Object.keys(value).every((key) => (RESOLVED_PROJECT_GRAPH_CORE_KEYS as readonly string[]).includes(key) || X_KEY_PATTERN.test(key));
}

/** true когда все id внутри `ids` уникальны — используется для `project_duplicate_id` diagnostics. */
export function hasDuplicateIds(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

const QUATERNION_UNIT_TOLERANCE = 1e-3;

/** |q| обязана быть близка к 1 (unit quaternion) — см. `project_transform_invalid`. */
export function isUnitQuaternion(q: Quaternion): boolean {
  const magnitude = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return Math.abs(magnitude - 1) <= QUATERNION_UNIT_TOLERANCE;
}

// ---------------------------------------------------------------------------------------------
// manifest_digest / configuration_digest (project.manifest.md §6: "Canonical JSON сортирует
// object keys и stable-id collections" — рекурсивно сортируем ключи объектов, порядок массивов
// не трогаем, он самостоятельно значим (position/order)). Git-чтение/YAML-парсинг остаются у
// Back (`apps/api/src/models/manifest.route.ts`) — здесь только детерминированное хеширование
// уже резолвленных данных, тот же класс функций, что `createConfigFingerprint` (`jobs/slicer.ts`).
// ---------------------------------------------------------------------------------------------

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/** Canonical JSON строго по §6 — вход другим потребителям для подписи/сравнения, не только digest. */
export function canonicalizeForDigest(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** `manifest_digest` (§6 п.8) — sha256 канонического JSON ВСЕГО резолвленного графа. */
export function computeManifestDigest(graph: ResolvedProjectGraph): string {
  return createHash("sha256").update(canonicalizeForDigest(graph), "utf8").digest("hex");
}

/** `configuration_digest` (§6 п.8) — sha256 канонического JSON одной выбранной конфигурации. */
export function computeConfigurationDigest(configuration: ManifestConfiguration): string {
  return createHash("sha256").update(canonicalizeForDigest(configuration), "utf8").digest("hex");
}
