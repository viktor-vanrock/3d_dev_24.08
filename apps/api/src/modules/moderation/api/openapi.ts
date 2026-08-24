import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { BannedUserResponseDto } from "./moderation.dto.ts";

export function ApiBanUserOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("moderation"),
    ApiOperation({ summary: "Ban and irreversibly anonymize a user" }),
    ApiSessionProtected(),
    ApiParam({ name: "id", required: true, schema: { type: "string", format: "uuid" } }),
    ApiResponse({ status: 200, type: BannedUserResponseDto }),
  );
}
