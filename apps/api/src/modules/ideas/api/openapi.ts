import { applyDecorators, type Type } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";

export function ApiIdeasOperation(summary: string, responseType: Type, options?: { readonly auth?: boolean; readonly created?: boolean }) {
  return applyDecorators(
    ApiTags("ideas"),
    ApiOperation({ summary, description: "Nest migration of the existing Ideas HTTP contract." }),
    ...(options?.auth === true ? [ApiSessionProtected()] : []),
    ApiResponse({ status: options?.created === true ? 201 : 200, description: "Successful Ideas response", type: responseType }),
  );
}
