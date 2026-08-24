import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiConsumes, ApiExtraModels, ApiOperation, ApiProduces, ApiResponse, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import {
  CatalogDraftResponseDto,
  ConceptGenerationResponseDto,
  ConceptsResponseDto,
  GenerationHealthResponseDto,
  GenerationLooseBodyDto,
  GenerationResponseDto,
  GenerationsResponseDto,
  ScanCreatedResponseDto,
  ScanPhotosResponseDto,
} from "./generations.dto.ts";

const JSON_ERROR_CONTENT = { "application/json": { schema: { $ref: getSchemaPath(ApiErrorEnvelopeDto) } } };

export function ApiGenerationsOperation(
  summary: string,
  options: {
    readonly session?: boolean;
    readonly status?: number;
    readonly body?: boolean;
    readonly multipart?: boolean;
    readonly binary?: boolean;
    readonly replay?: boolean;
    readonly accepted?: boolean;
    readonly response?: "health" | "scan" | "photos" | "generation" | "generations" | "concepts" | "concept-generation" | "catalog-draft";
  } = {},
): MethodDecorator {
  const responseType =
    options.response === "health"
      ? GenerationHealthResponseDto
      : options.response === "scan"
        ? ScanCreatedResponseDto
        : options.response === "photos"
          ? ScanPhotosResponseDto
          : options.response === "generations"
            ? GenerationsResponseDto
            : options.response === "concepts"
              ? ConceptsResponseDto
              : options.response === "concept-generation"
                ? ConceptGenerationResponseDto
                : options.response === "catalog-draft"
                  ? CatalogDraftResponseDto
                  : GenerationResponseDto;
  const binarySchema = { schema: { type: "string", format: "binary" } };
  const success =
    options.binary === true
      ? ApiResponse({
          status: options.status ?? 200,
          content: {
            "application/octet-stream": binarySchema,
            "image/png": binarySchema,
            "image/webp": binarySchema,
            "application/zip": binarySchema,
            "model/stl": binarySchema,
            "model/gltf-binary": binarySchema,
          },
        })
      : options.response === "concept-generation"
        ? ApiResponse({
            status: options.status ?? 200,
            content: { "application/json": { schema: { oneOf: [{ $ref: getSchemaPath(ConceptGenerationResponseDto) }, { $ref: getSchemaPath(GenerationResponseDto) }] } } },
          })
        : ApiResponse({ status: options.status ?? 200, type: responseType });
  const decorators: Array<ClassDecorator | MethodDecorator> = [
    ApiTags("generations"),
    ApiOperation({ summary }),
    ApiExtraModels(ConceptGenerationResponseDto, GenerationResponseDto),
    success,
  ];
  if (options.replay === true) decorators.push(ApiResponse({ status: 200, type: responseType }));
  if (options.accepted === true) decorators.push(ApiResponse({ status: 202, type: responseType }));
  if (options.session !== false) decorators.push(ApiSessionProtected());
  if (options.body === true) decorators.push(ApiBody({ type: GenerationLooseBodyDto }));
  if (options.multipart === true) decorators.push(ApiConsumes("multipart/form-data"));
  if (options.binary === true) decorators.push(ApiProduces("application/octet-stream", "image/png", "image/webp", "application/zip", "model/stl", "model/gltf-binary"));
  decorators.push(...[400, 401, 404, 413, 422].map((status) => ApiResponse({ status, content: JSON_ERROR_CONTENT })));
  return applyDecorators(...decorators);
}
