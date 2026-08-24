import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";

export function ApiAgentsOperation(summary: string, status = 200, responseType?: new () => object): MethodDecorator {
  return applyDecorators(
    ApiTags("agents"),
    ApiOperation({ summary, description: "Nest migration of the existing agent-account contract." }),
    ApiSessionProtected(),
    ApiResponse({ status, description: "Successful agent response", ...(responseType === undefined ? {} : { type: responseType }) }),
    ApiResponse({ status: 401, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 429, type: ApiErrorEnvelopeDto }),
  );
}
