import { applyDecorators, type Type } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";

export function ApiProfileInventoryOperation(
  summary: string,
  responseType: Type<unknown>,
  options: { readonly status?: number; readonly pathParams?: readonly string[] } = {},
): MethodDecorator {
  const decorators: MethodDecorator[] = [
    ApiTags("profile"),
    ApiOperation({ summary }),
    ApiSessionProtected(),
    ApiResponse({ status: options.status ?? 200, type: responseType }),
    ApiResponse({ status: 422, description: "Request validation failed", type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 500, description: "Unexpected server error", type: ApiErrorEnvelopeDto }),
  ];
  for (const name of options.pathParams ?? []) {
    decorators.push(ApiParam({ name, required: true, schema: { type: "string", format: "uuid" } }));
  }
  return applyDecorators(...decorators);
}
