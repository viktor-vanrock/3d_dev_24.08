import { applyDecorators } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
export function ApiPublicApiOperation(
  summary: string,
  options?: {
    session?: boolean;
    bearer?: boolean;
    status?: number;
    additionalSuccess?: readonly number[];
    responseType?: new () => object;
    additionalResponseType?: new () => object;
  },
) {
  return applyDecorators(
    ApiTags("public-api"),
    ApiOperation({ summary, description: "Nest migration of the existing public API contract." }),
    ...(options?.session ? [ApiSessionProtected()] : []),
    ...(options?.bearer ? [ApiBearerAuth()] : []),
    ApiResponse({ status: options?.status ?? 200, description: "Successful public API response", ...(options?.responseType === undefined ? {} : { type: options.responseType }) }),
    ...(options?.additionalSuccess ?? []).map((status) =>
      ApiResponse({ status, description: "Successful public API response", ...(options?.additionalResponseType === undefined ? {} : { type: options.additionalResponseType }) }),
    ),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 401, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 429, type: ApiErrorEnvelopeDto }),
  );
}
