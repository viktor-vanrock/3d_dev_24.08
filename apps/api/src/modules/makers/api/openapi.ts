import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Type } from "@nestjs/common";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";

export function ApiMakersOperation(summary: string, options?: { readonly public?: boolean; readonly status?: number; readonly responseType?: Type }) {
  return applyDecorators(
    ApiTags("makers"),
    ApiOperation({ summary, description: "Nest migration of the existing Makers HTTP contract." }),
    ...(options?.public === true ? [] : [ApiSessionProtected()]),
    ApiResponse({ status: options?.status ?? 200, description: "Successful Makers response", ...(options?.responseType === undefined ? {} : { type: options.responseType }) }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 401, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  );
}
