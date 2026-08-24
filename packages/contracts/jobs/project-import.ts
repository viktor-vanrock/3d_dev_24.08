// Шов `jobs` — API (`apps/api/src/models`+`git`, продюсер) → импорт-воркер (консюмер; сегодня
// внутренний обработчик apps/api/src/imports по прецеденту Cults3D, apps/api/src/import/connector.ts).
// Импортирует Git-репозиторий / пачку STL / составной 3MF в тот же резолвленный граф
// (packages/contracts/http/models.ts::ResolvedProjectGraph, project.manifest.md §8). Security/
// quarantine для source.kind="git" — отдельный шов MF-1966 (docs/architecture/git.import.security.md);
// этот файл не описывает исполнение fetch/лимиты, только payload/result API↔воркер. Никакой
// бизнес-логики.

import type { ManifestDiagnostic } from "../http/models.js";

export const PROJECT_IMPORT_CONTRACT_VERSION = "project-import.v1" as const;

/** Как apps/api/src/imports/queue.ts (Cults3D-прецедент) — переиспользуем тот же словарь статусов. */
export const PROJECT_IMPORT_STATUSES = ["queued", "running", "done", "failed"] as const;
export type ProjectImportStatus = (typeof PROJECT_IMPORT_STATUSES)[number];

export interface ProjectImportGitSource {
  kind: "git";
  remote_url: string;
  /** Ветка/тег/sha, по которым резолвится snapshot. Отсутствие — HEAD удалённого репо (project.manifest.md §8.3: snapshot конкретного resolved commit SHA). */
  ref: string | null;
}

/**
 * `upload_refs` — batch: project.manifest.md §8.1 «один regular artifact на файл … каждый файл
 * имеет независимый processing status/retry; все файлы сходятся в один draft/repo». Минимум один
 * элемент. Сырые байты НИКОГДА не идут в job payload — тот же принцип, что slice_trust.v1 не
 * кладёт raw config в очередь.
 */
export interface ProjectImportStlSource {
  kind: "stl";
  upload_refs: string[];
}

/** 3MF не раскладывается на независимые файлы — единый контейнер с object/build-item адресацией. */
export interface ProjectImportMultipart3mfSource {
  kind: "3mf";
  upload_ref: string;
}

export type ProjectImportSource = ProjectImportGitSource | ProjectImportStlSource | ProjectImportMultipart3mfSource;

export interface ProjectImportPayload {
  contract_version: typeof PROJECT_IMPORT_CONTRACT_VERSION;
  account_id: string;
  /** Целевой models.id (репо уже существует — fork/create делает API до постановки job). */
  model_id: string;
  source: ProjectImportSource;
  /** Дедуп повторной постановки той же job (см. decision doc §идемпотентность). */
  idempotency_key: string;
}

/** Статус одного файла STL-batch (§8.1) — для git/3mf ровно один элемент (весь источник — одна единица). */
export interface ProjectImportItemResult {
  upload_ref: string;
  status: Extract<ProjectImportStatus, "done" | "failed">;
  /** Id артефакта в резолвленном графе — null при failed. */
  artifact_id: string | null;
  diagnostics: ManifestDiagnostic[];
}

export interface ProjectImportResult {
  contract_version: typeof PROJECT_IMPORT_CONTRACT_VERSION;
  status: Extract<ProjectImportStatus, "done" | "failed">;
  /** Commit sha, который импорт создал/сверил во ВНУТРЕННЕМ bare-репо проекта. null при failed. */
  resolved_commit_sha: string | null;
  /** Только для source.kind="git" — sha внешнего ref на момент fetch. null для stl/3mf и при failed. */
  external_commit_sha: string | null;
  /** false — манифест отсутствовал в источнике; API синтезирует минимальный single-artifact манифест
   *  (project.manifest.md §8.1/§8.3: «простой проект остаётся простым», synthesize read-only projection). */
  manifest_present: boolean;
  items: ProjectImportItemResult[];
  /** Project-level diagnostics, не привязанные к одному файлу (напр. schema/reference ошибки резолва). */
  diagnostics: ManifestDiagnostic[];
  /** true — при failed прежняя last-known-good проекция проекта НЕ была тронута (project.manifest.md §8.3/§12). */
  last_known_good_preserved: boolean;
}

export const PROJECT_IMPORT_ERROR_CODES = [
  "project_import_untrusted_source",
  "project_import_limit_exceeded",
  "project_import_format_mismatch",
  "project_import_unsupported_format",
  "project_import_manifest_invalid",
  "project_import_contract_version_unsupported",
] as const;
export type ProjectImportErrorCode = (typeof PROJECT_IMPORT_ERROR_CODES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Structural guard payload — воркер обязан отклонить неизвестную contract_version, не понижать. */
export function isProjectImportPayload(value: unknown): value is ProjectImportPayload {
  if (!isRecord(value)) return false;
  if (value.contract_version !== PROJECT_IMPORT_CONTRACT_VERSION) return false;
  if (typeof value.account_id !== "string" || typeof value.model_id !== "string") return false;
  if (typeof value.idempotency_key !== "string" || value.idempotency_key.length === 0) return false;
  const source = value.source;
  if (!isRecord(source)) return false;
  if (source.kind === "git") return typeof source.remote_url === "string" && (source.ref === null || typeof source.ref === "string");
  if (source.kind === "stl") return Array.isArray(source.upload_refs) && source.upload_refs.length > 0 && source.upload_refs.every((ref) => typeof ref === "string");
  if (source.kind === "3mf") return typeof source.upload_ref === "string";
  return false;
}
