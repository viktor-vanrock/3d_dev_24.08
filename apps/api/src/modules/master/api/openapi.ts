import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { MasterStateResponseDto, PublicMasterResponseDto } from "./master.dto.ts";

export function ApiMasterOperation(summary: string, options: { readonly session?: boolean; readonly publicProfile?: boolean } = {}) {
  const decorators: Array<ClassDecorator | MethodDecorator> = [
    ApiTags("master"),
    ApiOperation({ summary }),
    ApiResponse({ status: 200, type: options.publicProfile === true ? PublicMasterResponseDto : MasterStateResponseDto }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
  ];
  if (options.session !== false) decorators.push(ApiSessionProtected());
  return applyDecorators(...decorators);
}
