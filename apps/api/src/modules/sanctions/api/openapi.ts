import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { SanctionAppealResponseDto, SanctionResponseDto } from "./response.dto.ts";
type Result = "sanction" | "sanction-list" | "sanction-null" | "appeal" | "appeal-list";
export function ApiSanctionOperation(summary: string, result: Result, uuidParam?: string): MethodDecorator {
  const successType = result === "appeal" || result === "appeal-list" ? SanctionAppealResponseDto : SanctionResponseDto;
  const status = summary.startsWith("Create") || summary.startsWith("Submit") ? 201 : 200;
  return applyDecorators(ApiTags("sanctions"), ApiOperation({ summary }), ApiSessionProtected(), ...(uuidParam ? [ApiParam({ name: uuidParam, schema: { type: "string", format: "uuid" } })] : []), ApiResponse({ status, type: successType, isArray: result === "sanction-list" || result === "appeal-list", description: result === "sanction-null" ? "Returns null when no active sanction exists" : undefined }), ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 401, description: "May return account_restricted with endsAt null for indefinite sanctions", type: ApiErrorEnvelopeDto }), ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }));
}
