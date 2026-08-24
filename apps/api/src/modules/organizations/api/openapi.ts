import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { CommunityOwnerClaimResponseDto, VendorClaimResponseDto, VendorClaimsResponseDto } from "./organizations.dto.ts";

export function ApiOrganizationsOperation(summary: string, status = 200, response: "claim" | "claims" | "owner" = "claim") {
  return applyDecorators(
    ApiTags("organizations"),
    ApiOperation({
      summary,
      description: "Nest migration of the verified vendor-claim and official-community ownership contract.",
    }),
    ApiSessionProtected(),
    ApiResponse({
      status,
      description: "Successful Organizations response",
      type: response === "claims" ? VendorClaimsResponseDto : response === "owner" ? CommunityOwnerClaimResponseDto : VendorClaimResponseDto,
    }),
    ApiResponse({ status: 401, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  );
}
