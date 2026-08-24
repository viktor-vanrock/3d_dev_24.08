import { createHash } from "node:crypto";
import { readFileContent } from "../../../git/repo.ts";
import { safeParseManifestYaml } from "./projectManifest/yamlSafe.ts";
import type { ProjectSliceSource } from "@portal/contracts/jobs/slicer-plate";

// Резолвер pinned project-as-code артефакта под `project-slice-request.v1` (MF-1986, решение
// на MF-1981): git blob по `source.revision` + `manifest.artifacts[artifact_id].path`
// (project-code.v1, `packages/contracts/http/models.ts`), сверка пересчитанного sha256 с
// заявленным клиентом значением. Произвольный `artifact.url` (внешний immutable ресурс,
// project.manifest.md) сознательно НЕ резолвится этой функцией — SOURCE_ROLE_UNSUPPORTED,
// фетч по author-controlled URL с сетевыми лимитами/SSRF-guard остаётся отдельным расширением
// (симметрично тому, что этот резолвер не парсит полный граф — только identity одного
// артефакта, полная валидация configuration/workflow — MF-1964/1965/1967).
//
// `portal.project.yaml` — то же файловое имя, что и у legacy-манифеста (MF-1967,
// `models/projectManifest/import/shared.ts::MANIFEST_FILENAME`); формат содержимого —
// project-code.v1 (kebab-case, `artifacts`/`configurations`/`workflows` id-maps), не
// camelCase legacy-схема того модуля. `safeParseManifestYaml` переиспользуется как есть — она
// YAML-safety-агностична к схеме (anchor/alias/depth/size guard), не привязана к конкретной форме.
export const PROJECT_MANIFEST_FILENAME = "portal.project.yaml";

/** Слайсить в v1 имеет смысл только печатную геометрию — прошивка/код-архив и т.п. отклоняются. */
const SLICEABLE_ARTIFACT_KINDS = new Set(["print-model"]);

export type ResolvePinnedArtifactErrorCode = "SOURCE_NOT_FOUND" | "SOURCE_ARTIFACT_MISMATCH" | "SOURCE_ROLE_UNSUPPORTED";

export class ResolvePinnedArtifactError extends Error {
  readonly code: ResolvePinnedArtifactErrorCode;
  constructor(code: ResolvePinnedArtifactErrorCode) {
    super(code);
    this.name = "ResolvePinnedArtifactError";
    this.code = code;
  }
}

export interface ResolvedPinnedArtifact {
  path: string;
  kind: string;
  bytes: Buffer;
  /** Пересчитанный sha256 реально прочитанных байт — источник истины для staged_object_key. */
  sha256: string;
}

// Тот же инвариант, что `git/repo.ts::assertSafeRelativePath`/
// `projectManifest/security.ts::assertArtifactPathSafe`, продублированный намеренно узко:
// этот модуль не тянет диагностику старой схемы (MANIFEST_ERROR_CODE принадлежит другому
// контракту), а git/repo.ts сам уже проверяет путь внутри readFileContent — эта проверка здесь
// нужна ДО чтения, чтобы не путать "путь небезопасен" с "путь не существует" (оба сейчас читались
// бы как null из readFileContent, различие важно для честного SOURCE_NOT_FOUND vs программной ошибки).
function isSafeRelativePath(candidate: string): boolean {
  return candidate.length > 0 && !candidate.startsWith("/") && !candidate.includes("\\") && !candidate.split("/").some((segment) => segment === "" || segment === "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Резолвит и верифицирует один pinned артефакт. Кидает `ResolvePinnedArtifactError` с
 * безопасным кодом на любой сбой (манифест/артефакт отсутствует, роль не поддерживается,
 * hash не совпал) — вызывающий код (slicing.route.ts) маппит код на HTTP-статус.
 */
export async function resolvePinnedArtifact(
  repoPath: string,
  source: Pick<ProjectSliceSource, "revision" | "configuration_id" | "workflow_step_id" | "artifact_id" | "artifact_sha256">,
): Promise<ResolvedPinnedArtifact> {
  const manifestBytes = await readFileContent(repoPath, PROJECT_MANIFEST_FILENAME, source.revision);
  if (!manifestBytes) throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");

  let parsedValue: unknown;
  try {
    parsedValue = safeParseManifestYaml(manifestBytes).value;
  } catch {
    throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");
  }
  if (!isRecord(parsedValue)) throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");

  const configurations = parsedValue.configurations;
  if (!isRecord(configurations)) throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");
  const configuration = configurations[source.configuration_id];
  if (!isRecord(configuration)) throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");

  const configuredArtifacts = configuration.artifacts;
  if (!Array.isArray(configuredArtifacts) || !configuredArtifacts.includes(source.artifact_id)) {
    throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");
  }

  const workflowId = configuration.workflow;
  const workflows = parsedValue.workflows;
  if (typeof workflowId !== "string" || !isRecord(workflows)) throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");
  const workflow = workflows[workflowId];
  if (!isRecord(workflow) || !isRecord(workflow.steps) || !(source.workflow_step_id in workflow.steps)) {
    throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");
  }

  const artifacts = parsedValue.artifacts;
  if (!isRecord(artifacts)) throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");
  const artifact = artifacts[source.artifact_id];
  if (!isRecord(artifact)) throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");

  const artifactPath = artifact.path;
  const artifactKind = artifact.kind;
  if (typeof artifactPath !== "string" || !isSafeRelativePath(artifactPath)) {
    throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");
  }
  if (typeof artifactKind !== "string" || !SLICEABLE_ARTIFACT_KINDS.has(artifactKind)) {
    throw new ResolvePinnedArtifactError("SOURCE_ROLE_UNSUPPORTED");
  }

  const bytes = await readFileContent(repoPath, artifactPath, source.revision);
  if (!bytes) throw new ResolvePinnedArtifactError("SOURCE_NOT_FOUND");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== source.artifact_sha256) throw new ResolvePinnedArtifactError("SOURCE_ARTIFACT_MISMATCH");

  return { path: artifactPath, kind: artifactKind, bytes, sha256 };
}
