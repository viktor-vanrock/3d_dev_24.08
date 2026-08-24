import { HttpStatus } from "@nestjs/common";

export type ProjectErrorCode =
  | "request.validation.v1"
  | "auth.unauthenticated.v1"
  | "request.rate_limited.v1"
  | "internal.safe_error.v1"
  | "request.payload_too_large.v1"
  | "request.unsupported_media_type.v1"
  | "project.file_format_mismatch.v1"
  | "project.not_found.v1"
  | "project.model_not_found.v1"
  | "project.revision_not_found.v1"
  | "project.asset_not_found.v1"
  | "project.version_conflict.v1"
  | "project.idempotency_conflict.v1"
  | "project.request_in_progress.v1"
  | "project.primary_model_required.v1"
  | "project.primary_model_published.v1"
  | "project.model_published.v1"
  | "project.ready_primary_required.v1"
  | "project.publication_conflict.v1";

export class ProjectError extends Error {
  constructor(
    public readonly status: HttpStatus,
    public readonly code: ProjectErrorCode,
    public readonly safeMessage: string,
    public readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(safeMessage);
    this.name = "ProjectError";
  }
}

export const projectNotFound = () => new ProjectError(HttpStatus.NOT_FOUND, "project.not_found.v1", "Проект не найден");
export const modelNotFound = () => new ProjectError(HttpStatus.NOT_FOUND, "project.model_not_found.v1", "Модель не найдена");
export const revisionNotFound = () => new ProjectError(HttpStatus.NOT_FOUND, "project.revision_not_found.v1", "Ревизия не найдена");
export const assetNotFound = () => new ProjectError(HttpStatus.NOT_FOUND, "project.asset_not_found.v1", "Файл не найден");
export const versionConflict = () => new ProjectError(HttpStatus.CONFLICT, "project.version_conflict.v1", "Версия проекта изменилась");

export function parseIfMatch(raw: string | string[] | undefined): number {
  if (Array.isArray(raw) || raw === undefined) {
    throw new ProjectError(HttpStatus.BAD_REQUEST, "request.validation.v1", "Требуется If-Match");
  }
  const match = /^"([1-9][0-9]*)"$/.exec(raw);
  const version = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(version)) {
    throw new ProjectError(HttpStatus.BAD_REQUEST, "request.validation.v1", "Некорректный If-Match");
  }
  return version;
}

export function projectEtag(version: number): string {
  return `"${version}"`;
}

export function parseIdempotencyKey(raw: string | string[] | undefined): string {
  if (Array.isArray(raw) || raw === undefined || !/^[\x20-\x7e]{1,128}$/.test(raw)) {
    throw new ProjectError(HttpStatus.BAD_REQUEST, "request.validation.v1", "Некорректный Idempotency-Key");
  }
  return raw;
}
