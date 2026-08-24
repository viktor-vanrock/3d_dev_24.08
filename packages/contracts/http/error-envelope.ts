export const API_ERROR_CONTRACT_VERSION = "api-error.v1" as const;

export const API_ERROR_CODES = [
  "auth.unauthorized.v1",
  "auth.forbidden.v1",
  "validation.invalid.v1",
  "http.bad_request.v1",
  "http.malformed_json.v1",
  "http.not_found.v1",
  "http.timeout.v1",
  "http.aborted.v1",
  "http.not_implemented.v1",
  "http.upstream.v1",
  "http.service_unavailable.v1",
  "http.upstream_timeout.v1",
  "http.client_error.v1",
  "http.server_error.v1",
  "http.internal.v1",
  "auth.unauthenticated.v1",
  "request.validation.v1",
  "request.payload_too_large.v1",
  "request.unsupported_media_type.v1",
  "request.rate_limited.v1",
  "internal.safe_error.v1",
  "project.file_format_mismatch.v1",
  "project.not_found.v1",
  "project.model_not_found.v1",
  "project.revision_not_found.v1",
  "project.asset_not_found.v1",
  "project.version_conflict.v1",
  "project.idempotency_conflict.v1",
  "project.request_in_progress.v1",
  "project.primary_model_required.v1",
  "project.primary_model_published.v1",
  "project.model_published.v1",
  "project.ready_primary_required.v1",
  "project.publication_conflict.v1",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly requestId: string;
}

export interface ApiErrorEnvelope {
  readonly error: ApiError;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && API_ERROR_CODES.some((code) => code === value);
}

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return isApiErrorCode(value.error.code)
    && typeof value.error.message === "string"
    && value.error.message.length > 0
    && typeof value.error.requestId === "string"
    && value.error.requestId.length > 0;
}
