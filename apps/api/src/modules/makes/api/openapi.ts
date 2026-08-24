import { applyDecorators, type Type } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";

export function ApiMakesOperation(summary: string, status = 200, responseType?: Type): MethodDecorator {
  return applyDecorators(
    ApiTags("makes"),
    ApiOperation({ summary, description: "Nest migration of the existing Makes HTTP contract." }),
    ApiSessionProtected(),
    ...(summary === "Read a make photo"
      ? [
          ApiResponse({
            status: 200,
            content: {
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/png": { schema: { type: "string", format: "binary" } },
              "application/octet-stream": { schema: { type: "string", format: "binary" } },
            },
          }),
          ApiResponse({ status: 302, description: "Redirect to a presigned photo URL", headers: { Location: { schema: { type: "string", format: "uri" } } } }),
        ]
      : [ApiResponse({ status, description: "Successful Makes response", ...(responseType === undefined ? {} : { type: responseType }) })]),
  );
}

export function ApiMakeCreate(responseType: Type): MethodDecorator {
  return applyDecorators(
    ApiMakesOperation("Publish a make", 201, responseType),
    ApiConsumes("multipart/form-data"),
    ApiBody({
      schema: {
        type: "object",
        required: ["machine_id", "material_ids", "photos"],
        properties: {
          model_id: { type: "string", format: "uuid" },
          machine_id: { type: "string", format: "uuid" },
          material_ids: { type: "string", description: "Comma-separated material UUIDs" },
          caption: { type: "string" },
          printability_rating: { type: "string" },
          geometry_quality_rating: { type: "string" },
          surface_quality_rating: { type: "string" },
          issue_tags: { type: "string" },
          notes: { type: "string" },
          print_settings: { type: "string" },
          photos: { type: "array", items: { type: "string", format: "binary" } },
        },
      },
    }),
  );
}
