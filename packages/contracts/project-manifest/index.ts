// portal.project.yaml v1 (MF-1967) — источник правды: ./schema.v1.json. Типы здесь — ручное
// зеркало схемы для apps/api (parser/resolver — apps/api/src/models/projectManifest/), сверяются
// в том же PR, что и правка схемы (README.md § «Правила изменения»). Бизнес-логика (парсинг,
// security-проверки, резолвинг в graph) сюда не входит — только форма контракта, как у
// device-protocol/handshake.v1.

export const PROJECT_MANIFEST_SCHEMA_VERSION = 1 as const;

/** Логическая роль артефакта на уровне манифеста — НЕ 1:1 с `model_files.role` (Data-домен). */
export type ManifestArtifactRole =
  | "source"
  | "drawing"
  | "cnc_program"
  | "gerber"
  | "code_archive"
  | "firmware"
  | "doc"
  | "other";

export const MANIFEST_ARTIFACT_ROLES: readonly ManifestArtifactRole[] = [
  "source",
  "drawing",
  "cnc_program",
  "gerber",
  "code_archive",
  "firmware",
  "doc",
  "other",
];

/** Произвольные `x-*` расширения — резолвер обязан пронести их насквозь, не читая семантику. */
export type ManifestExtensions = Record<string, unknown>;

export interface ManifestProject extends ManifestExtensions {
  name: string;
  slug?: string;
}

export interface ManifestConfiguration extends ManifestExtensions {
  id: string;
  name: string;
  default?: boolean;
  componentRefs?: string[];
}

export interface ManifestArtifact extends ManifestExtensions {
  id: string;
  role: ManifestArtifactRole;
  path: string;
  format?: string;
  /** sha256 hex, опционально — резолвер сверяет с фактическим содержимым входа. */
  checksum?: string;
}

export interface ManifestComponent extends ManifestExtensions {
  id: string;
  name: string;
  craft?: string;
  artifactRefs?: string[];
  quantity?: number;
}

export interface ManifestBomVendor extends ManifestExtensions {
  name?: string;
  /** Непрозрачная ссылка — резолвер её не разыменовывает (SSRF-guard в apps/api security.ts). */
  url?: string;
}

export interface ManifestBomItem extends ManifestExtensions {
  id: string;
  name: string;
  quantity: number;
  unit?: string;
  vendor?: ManifestBomVendor;
  notes?: string;
}

export interface ManifestConnection extends ManifestExtensions {
  id: string;
  from: string;
  to: string;
  kind?: string;
  notes?: string;
}

export interface ManifestPhase extends ManifestExtensions {
  id: string;
  name: string;
  dependsOn?: string[];
  componentRefs?: string[];
  notes?: string;
}

/** Форма файла `portal.project.yaml` v1 после YAML-парсинга, до резолвинга в граф. */
export interface ProjectManifestV1 extends ManifestExtensions {
  schemaVersion: typeof PROJECT_MANIFEST_SCHEMA_VERSION;
  project: ManifestProject;
  configurations?: ManifestConfiguration[];
  artifacts?: ManifestArtifact[];
  components?: ManifestComponent[];
  bom?: ManifestBomItem[];
  connections?: ManifestConnection[];
  phases?: ManifestPhase[];
}
