import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";

export function ApiHoneypotOperation() {
  return applyDecorators(
    ApiTags("security"),
    ApiOperation({ summary: "Record a catalog honeypot hit" }),
    ApiSessionProtected(),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
  );
}
