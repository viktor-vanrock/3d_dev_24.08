import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  NotImplementedException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter, classifyError } from "./api-exception.filter.ts";
import { REQUEST_ID } from "../observability/request-id.ts";
import type { RuntimeLogger } from "../observability/runtime-logger.ts";

const REQUEST_ID_VALUE = "11111111-1111-4111-8111-111111111111";

function filterResponse(exception: unknown): {
  readonly status: number | undefined;
  readonly body: unknown;
  readonly setHeader: ReturnType<typeof vi.fn>;
  readonly logError: ReturnType<typeof vi.fn>;
} {
  let status: number | undefined;
  let body: unknown;
  const setHeader = vi.fn();
  const response = {
    setHeader,
    status(value: number) {
      status = value;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  };
  const request = { [REQUEST_ID]: REQUEST_ID_VALUE, header: vi.fn(), method: "GET", originalUrl: "/models?q=person@example.test" };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  const logError = vi.fn();
  const logger = { error: logError } as unknown as RuntimeLogger;

  new ApiExceptionFilter(logger).catch(exception, host);
  return { status, body, setHeader, logError };
}

describe("API error classification", () => {
  it.each([
    [new UnauthorizedException(), 401, "auth.unauthorized.v1"],
    [new ForbiddenException(), 403, "auth.forbidden.v1"],
    [new NotFoundException(), 404, "http.not_found.v1"],
    [new UnprocessableEntityException(), 422, "validation.invalid.v1"],
    [new Error("SQL select secret"), 500, "http.internal.v1"],
    [new SyntaxError("Unexpected token with secret"), 400, "http.malformed_json.v1"],
    [new NotImplementedException("provider secret"), 501, "http.not_implemented.v1"],
    [new BadGatewayException("provider secret"), 502, "http.upstream.v1"],
    [new ServiceUnavailableException("provider secret"), 503, "http.service_unavailable.v1"],
    [new HttpException("provider secret", 599), 599, "http.server_error.v1"],
  ])("maps %s to status %i and stable code %s", (exception, status, code) => {
    expect(classifyError(exception)).toMatchObject({ status, code });
  });

  it.each([
    ["validation", new UnprocessableEntityException({ password: "raw-password", email: "person@example.test" }), 422, "validation.invalid.v1", "Данные не прошли валидацию"],
    ["provider", new BadGatewayException("provider token=raw-provider-secret for person@example.test"), 502, "http.upstream.v1", "Внешний сервис не выполнил запрос"],
    [
      "database",
      Object.assign(new Error("duplicate key person@example.test"), {
        code: "23505",
        query: "insert into users(email, password_hash) values (...) returning raw-db-secret",
        detail: "Key (email)=(person@example.test) already exists",
      }),
      500,
      "http.internal.v1",
      "Внутренняя ошибка",
    ],
    [
      "unhandled",
      Object.assign(new Error("raw-unhandled-secret for person@example.test"), {
        stack: "Error: raw-unhandled-secret\n at private/function.ts:1:1",
      }),
      500,
      "http.internal.v1",
      "Внутренняя ошибка",
    ],
  ])("returns a safe versioned envelope for %s errors", (_kind, exception, status, code, message) => {
    const result = filterResponse(exception);

    expect(result.status).toBe(status);
    expect(result.setHeader).toHaveBeenCalledWith("x-request-id", REQUEST_ID_VALUE);
    expect(result.body).toEqual({
      error: { code, message, requestId: REQUEST_ID_VALUE },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/raw-|person@example\.test|password|token=|insert into|duplicate key|private\/function|stack/i);
    expect(result.logError).toHaveBeenCalledWith(
      {
        event: "api.request.failed",
        request_id: REQUEST_ID_VALUE,
        method: "GET",
        // Query отброшена: иначе PII из ?q= попадает в лог мимо redact.
        path: "/models",
        status_code: status,
        error_code: code,
      },
      "api request failed",
    );
  });

  it.each([
    ["TimeoutError", 408, "http.timeout.v1"],
    ["AbortError", 499, "http.aborted.v1"],
  ])("keeps %s distinct from ordinary 5xx", (name, status, code) => {
    const exception = new Error("provider response with secret");
    exception.name = name;

    expect(classifyError(exception)).toMatchObject({ status, code });
  });
});
