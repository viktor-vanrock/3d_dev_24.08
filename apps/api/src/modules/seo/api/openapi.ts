import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiProduces, ApiResponse, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";

export function ApiSeoOperation(summary: string, contentType: string): MethodDecorator {
  const image = contentType === "image/webp";
  return applyDecorators(
    ApiTags("seo"),
    ApiOperation({ summary }),
    ApiProduces(contentType),
    ApiResponse({ status: 200, description: "Raw response body", content: { [contentType]: { schema: { type: "string", ...(image ? { format: "binary" } : {}) } } } }),
    ...(image ? [ApiResponse({ status: 302, description: "Redirect to the public image URL", headers: { Location: { schema: { type: "string", format: "uri" } } } })] : []),
    ...(summary.includes("metadata") || image
      ? [
          ApiResponse({
            status: 404,
            content: { "application/json": { schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) } } },
          }),
        ]
      : []),
  );
}
