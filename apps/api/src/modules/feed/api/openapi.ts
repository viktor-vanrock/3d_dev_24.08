import { applyDecorators, type Type } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";

export function ApiFeedOperation(
  summary: string,
  options: { readonly session?: boolean; readonly status?: number; readonly binary?: boolean; readonly responseType?: Type } = {},
): MethodDecorator {
  const decorators: Array<ClassDecorator | MethodDecorator> = [
    ApiTags("feed"),
    ApiOperation({ summary }),
    ...(options.binary === true ? [] : [ApiResponse({ status: options.status ?? 200, ...(options.responseType === undefined ? {} : { type: options.responseType }) })]),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  ];
  if (options.session !== false) decorators.push(ApiSessionProtected());
  if (options.binary === true)
    decorators.push(
      ApiResponse({
        status: 200,
        content: {
          "application/octet-stream": { schema: { type: "string", format: "binary" } },
          "image/png": { schema: { type: "string", format: "binary" } },
          "image/jpeg": { schema: { type: "string", format: "binary" } },
          "video/mp4": { schema: { type: "string", format: "binary" } },
        },
      }),
      ApiResponse({ status: 302, description: "Redirect to the public asset URL", headers: { Location: { schema: { type: "string", format: "uri" } } } }),
    );
  return applyDecorators(...decorators);
}

export function ApiFeedUpload(summary: string, responseType: Type): MethodDecorator {
  return applyDecorators(
    ApiFeedOperation(summary, { status: 201, responseType }),
    ApiConsumes("multipart/form-data"),
    ApiBody({ schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } }),
  );
}
