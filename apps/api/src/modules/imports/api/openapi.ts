import { applyDecorators, type Type } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";

export function ApiImportsOperation(
  summary: string,
  responseType: Type<unknown>,
  options: { readonly created?: boolean; readonly idParam?: boolean; readonly badRequest?: boolean; readonly notFound?: boolean } = {},
) {
  return applyDecorators(
    ApiTags("imports"),
    ApiOperation({ summary, description: "Nest migration of the existing import jobs HTTP contract." }),
    ApiSessionProtected(),
    ApiResponse({ status: options.created === true ? 201 : 200, type: responseType }),
    ...(options.badRequest === true ? [ApiResponse({ status: 400, type: ApiErrorEnvelopeDto })] : []),
    ...(options.notFound === true ? [ApiResponse({ status: 404, type: ApiErrorEnvelopeDto })] : []),
    ApiResponse({ status: 500, type: ApiErrorEnvelopeDto }),
    ...(options.idParam === true ? [ApiParam({ name: "id", required: true, schema: { type: "string", format: "uuid" } })] : []),
  );
}
