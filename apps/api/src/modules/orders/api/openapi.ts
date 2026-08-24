import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { OrderResponseDto } from "./orders.dto.ts";

export function ApiOrdersOperation(summary: string, options?: { readonly created?: boolean }) {
  return applyDecorators(
    ApiTags("orders"),
    ApiOperation({
      summary,
      description: "Nest migration of the existing Orders HTTP contract.",
    }),
    ApiSessionProtected(),
    ApiResponse({
      status: options?.created === true ? 201 : 200,
      description: "Successful Orders response",
      type: OrderResponseDto,
    }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  );
}
