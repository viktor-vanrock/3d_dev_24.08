import { Catch, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import type { ApiErrorCode } from "@portal/contracts/http/error-envelope";
import { getRequestId, type RequestWithId } from "../observability/request-id.ts";
import { RuntimeLogger } from "../observability/runtime-logger.ts";
import { ProjectError } from "../../modules/projects/domain/project.errors.ts";
import { AccountRestrictedException } from "../auth/account-restricted.exception.ts";
import * as SanctionErrors from "../../modules/sanctions/domain/sanction.errors.ts";

interface ClassifiedError {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
}

const HTTP_ERRORS: Partial<Record<number, Omit<ClassifiedError, "status">>> = {
  [HttpStatus.BAD_REQUEST]: { code: "http.bad_request.v1", message: "Некорректный запрос" },
  [HttpStatus.UNAUTHORIZED]: { code: "auth.unauthorized.v1", message: "Требуется авторизация" },
  [HttpStatus.FORBIDDEN]: { code: "auth.forbidden.v1", message: "Доступ запрещён" },
  [HttpStatus.NOT_FOUND]: { code: "http.not_found.v1", message: "Ресурс не найден" },
  [HttpStatus.UNPROCESSABLE_ENTITY]: { code: "validation.invalid.v1", message: "Данные не прошли валидацию" },
  [HttpStatus.REQUEST_TIMEOUT]: { code: "http.timeout.v1", message: "Время обработки запроса истекло" },
  [HttpStatus.NOT_IMPLEMENTED]: { code: "http.not_implemented.v1", message: "Функция пока недоступна" },
  [HttpStatus.BAD_GATEWAY]: { code: "http.upstream.v1", message: "Внешний сервис не выполнил запрос" },
  [HttpStatus.SERVICE_UNAVAILABLE]: { code: "http.service_unavailable.v1", message: "Сервис временно недоступен" },
  [HttpStatus.GATEWAY_TIMEOUT]: { code: "http.upstream_timeout.v1", message: "Внешний сервис не ответил вовремя" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMalformedJson(exception: unknown): boolean {
  if (exception instanceof SyntaxError) return true;
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (isRecord(response) && typeof response.message === "string") {
      return /json|unexpected token|expected (?:property|double-quoted)/i.test(response.message);
    }
  }
  if (!isRecord(exception)) return false;
  if (exception.type === "entity.parse.failed") return true;
  return exception.cause instanceof SyntaxError || (isRecord(exception.cause) && exception.cause.type === "entity.parse.failed");
}

export function classifyError(exception: unknown, projectRoute = false): ClassifiedError {
  if (exception instanceof AccountRestrictedException) return { status: HttpStatus.UNAUTHORIZED, code: "account_restricted" as ApiErrorCode, message: "Account is restricted" };
  const sanctionErrorMap = new Map<new (...args: never[]) => Error, [number, string]>([
    [SanctionErrors.SanctionSelfTargetError, [400, "sanction.self_target"]], [SanctionErrors.SanctionInvalidReasonCodeError, [400, "sanction.invalid_reason_code"]], [SanctionErrors.SanctionEndsAtInPastError, [400, "sanction.ends_at_in_past"]], [SanctionErrors.SanctionIdempotencyConflictError, [409, "sanction.idempotency_conflict"]], [SanctionErrors.SanctionActorNotStaffError, [403, "sanction.actor_not_staff"]], [SanctionErrors.SanctionTargetNotFoundError, [404, "sanction.target_not_found"]], [SanctionErrors.SanctionTargetIsBootstrapAdminError, [403, "sanction.target_is_bootstrap_admin"]], [SanctionErrors.SanctionAlreadyActiveError, [409, "sanction.already_active"]], [SanctionErrors.SanctionNotActiveError, [409, "sanction.not_active"]], [SanctionErrors.SanctionAppealSubmitterMismatchError, [403, "sanction.appeal_submitter_mismatch"]], [SanctionErrors.SanctionAppealTargetSanctionNotActiveError, [409, "sanction.appeal_target_sanction_not_active"]], [SanctionErrors.SanctionAppealAlreadyPendingError, [409, "sanction.appeal_already_pending"]], [SanctionErrors.SanctionAppealNotFoundError, [404, "sanction.appeal_not_found"]], [SanctionErrors.SanctionAppealNotPendingError, [409, "sanction.appeal_not_pending"]], [SanctionErrors.SanctionAppealResolverIsCreatorError, [403, "sanction.appeal_resolver_is_creator"]], [SanctionErrors.SanctionAppealForbiddenError, [403, "sanction.appeal_forbidden"]],
  ]);
  for (const [type, [status, code]] of sanctionErrorMap) if (exception instanceof type) return { status, code: code as ApiErrorCode, message: "Sanction request rejected" };
  if (exception instanceof ProjectError) {
    return { status: exception.status, code: exception.code, message: exception.safeMessage };
  }
  if (projectRoute && isRecord(exception) && exception.code === "LIMIT_FILE_SIZE") {
    return { status: HttpStatus.PAYLOAD_TOO_LARGE, code: "request.payload_too_large.v1", message: "Файл превышает допустимый размер" };
  }
  if (isRecord(exception) && exception.name === "AbortError") {
    return { status: 499, code: "http.aborted.v1", message: "Запрос отменён" };
  }
  if (isRecord(exception) && (exception.name === "TimeoutError" || exception.code === "ETIMEDOUT")) {
    return { status: HttpStatus.REQUEST_TIMEOUT, ...HTTP_ERRORS[HttpStatus.REQUEST_TIMEOUT]! };
  }
  if (isMalformedJson(exception)) {
    return { status: HttpStatus.BAD_REQUEST, code: "http.malformed_json.v1", message: "Некорректный JSON" };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (projectRoute && status === 401) {
      return { status, code: "auth.unauthenticated.v1", message: "Требуется авторизация" };
    }
    if (projectRoute && (status === 400 || status === 422)) {
      return { status: HttpStatus.BAD_REQUEST, code: "request.validation.v1", message: "Некорректный запрос" };
    }
    const known = HTTP_ERRORS[status];
    if (known !== undefined) return { status, ...known };
    if (status >= 400 && status < 500) {
      return { status, code: "http.client_error.v1", message: "Запрос отклонён" };
    }
    if (status >= 500 && status < 600) {
      return { status, code: "http.server_error.v1", message: "Ошибка обработки запроса" };
    }
  }
  return projectRoute
    ? { status: HttpStatus.INTERNAL_SERVER_ERROR, code: "internal.safe_error.v1", message: "Внутренняя ошибка" }
    : { status: HttpStatus.INTERNAL_SERVER_ERROR, code: "http.internal.v1", message: "Внутренняя ошибка" };
}

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter<unknown> {
  constructor(@Inject(RuntimeLogger) private readonly logger: RuntimeLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const requestId = getRequestId(request);
    const url = request.originalUrl ?? request.url ?? "";
    const projectRoute = /^\/projects(?:\/|\?|$)/.test(url);
    const initial = classifyError(exception, projectRoute);
    const classified = /^\/(?:sanctions|appeals|users\/[0-9a-f-]+\/sanctions)(?:\/|\?|$)/i.test(url) && initial.status === 422
      ? { status: HttpStatus.BAD_REQUEST, code: "http.bad_request.v1" as ApiErrorCode, message: "Некорректный запрос" }
      : initial;

    if (exception instanceof ProjectError) {
      for (const [name, value] of Object.entries(exception.headers)) response.setHeader(name, value);
    }

    response.setHeader("x-request-id", requestId);

    this.logger.error(
      {
        event: "api.request.failed",
        request_id: requestId,
        method: request.method,
        // Без query-строки: в ней бывает PII (см. RUNTIME_REDACTION_PATHS).
        path: url.split("?")[0],
        status_code: classified.status,
        error_code: classified.code,
      },
      "api request failed",
    );
    const restricted = exception instanceof AccountRestrictedException;
    response.status(classified.status).json({
      error: {
        code: classified.code,
        message: classified.message,
        ...(restricted ? { endsAt: exception.endsAt } : {}),
        requestId,
      },
    });
  }
}
