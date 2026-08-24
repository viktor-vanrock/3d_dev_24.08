import { applyDecorators, type Type } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";

export function ApiPushOperation(summary: string, responseType: Type<unknown>, status = 200): MethodDecorator {
  return applyDecorators(ApiTags("push"), ApiOperation({ summary }), ApiSessionProtected(), ApiResponse({ status, type: responseType }));
}
