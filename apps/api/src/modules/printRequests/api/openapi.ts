import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { PrintRequestResponseDto } from "./print-requests.dto.ts";

export function ApiPrintRequestsOperation(summary: string, options?: { readonly created?: boolean; readonly list?: boolean }) {
  return applyDecorators(
    ApiTags("print-requests"),
    ApiOperation({
      summary,
      description: "Nest migration of the existing Print Requests HTTP contract.",
    }),
    ApiSessionProtected(),
    ApiResponse({
      status: options?.created === true ? 201 : 200,
      description: "Successful Print Requests response",
      type: options?.list === true ? [PrintRequestResponseDto] : PrintRequestResponseDto,
    }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 429, type: ApiErrorEnvelopeDto }),
  );
}
