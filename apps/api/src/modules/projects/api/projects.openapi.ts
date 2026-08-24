import { applyDecorators, type Type } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiSecurity } from "@nestjs/swagger";
import type { ProjectErrorCode } from "../domain/project.errors.ts";

interface ProjectOperationOptions {
  readonly operationId: string;
  readonly summary: string;
  readonly success: number;
  readonly response?: Type<unknown>;
  readonly security: "public" | "protected" | "optional";
  readonly projectParam?: boolean;
  readonly modelParam?: boolean;
  readonly revisionParam?: boolean;
  readonly ifMatch?: boolean;
  readonly idempotency?: boolean;
  readonly multipart?: "model" | "revision";
  readonly location?: boolean;
  readonly etag?: boolean;
  readonly errors?: Readonly<Partial<Record<number, readonly ProjectErrorCode[]>>>;
}

function errorSchema(codes: readonly ProjectErrorCode[]) {
  return {
    allOf: [
      { $ref: "#/components/schemas/ApiErrorEnvelopeDto" },
      {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: {
            type: "object",
            additionalProperties: false,
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string", enum: [...codes] },
              message: { type: "string", minLength: 1 },
              requestId: { type: "string", minLength: 1 },
            },
          },
        },
      },
    ],
  };
}

export function ApiProjectOperation(options: ProjectOperationOptions): MethodDecorator {
  const security: Array<Record<string, string[]>> =
    options.security === "public" ? [] : options.security === "optional" ? [{}, { portal_session: [] }, { bearer: [] }] : [{ portal_session: [] }, { bearer: [] }];
  const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [ApiOperation({ operationId: options.operationId, summary: options.summary, security })];
  if (options.security === "protected") decorators.push(ApiSecurity("portal_session"), ApiSecurity("bearer"));
  if (options.projectParam) decorators.push(ApiParam({ name: "projectId", format: "uuid" }));
  if (options.modelParam) decorators.push(ApiParam({ name: "modelId", format: "uuid" }));
  if (options.revisionParam) decorators.push(ApiParam({ name: "revisionId", format: "uuid" }));
  if (options.ifMatch) decorators.push(ApiHeader({ name: "If-Match", required: true, schema: { type: "string", pattern: '^"[1-9][0-9]*"$' } }));
  if (options.idempotency) decorators.push(ApiHeader({ name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 1, maxLength: 128 } }));
  if (options.multipart !== undefined) {
    decorators.push(
      ApiConsumes("multipart/form-data"),
      ApiBody({
        required: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: options.multipart === "model" ? ["file", "name"] : ["file"],
          properties: {
            file: { type: "string", format: "binary", maxLength: 104_857_600 },
            ...(options.multipart === "model"
              ? {
                  name: { type: "string", minLength: 1, maxLength: 120 },
                  manufacturing_method: { type: "string", enum: ["fdm", "sla", "cnc", "laser"] },
                  requires_ams: { type: "boolean", default: false },
                }
              : {}),
          },
        },
      }),
    );
  }
  const headers = {
    ...(options.location ? { Location: { required: true, schema: { type: "string", format: "uri-reference" } } } : {}),
    ...(options.etag ? { ETag: { required: true, schema: { type: "string", pattern: '^"[1-9][0-9]*"$' } } } : {}),
  };
  decorators.push(
    ApiResponse({
      status: options.success,
      description: options.success === 204 ? "No content" : options.success === 302 ? "Redirect" : "Success",
      ...(options.response === undefined ? {} : { type: options.response }),
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
    }),
  );
  const errors: Partial<Record<number, readonly ProjectErrorCode[]>> = {
    ...(options.security === "protected" ? { 401: ["auth.unauthenticated.v1"] as const } : {}),
    ...options.errors,
  };
  for (const [rawStatus, codes] of Object.entries(errors)) {
    if (codes === undefined || codes.length === 0) continue;
    decorators.push(ApiResponse({ status: Number(rawStatus), schema: errorSchema(codes) }));
  }
  decorators.push(ApiResponse({ status: 429, schema: errorSchema(["request.rate_limited.v1"]) }), ApiResponse({ status: 500, schema: errorSchema(["internal.safe_error.v1"]) }));
  return applyDecorators(...decorators);
}
