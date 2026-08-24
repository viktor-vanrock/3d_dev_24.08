import type { INestApplication } from "@nestjs/common";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { ApiErrorDto, ApiErrorEnvelopeDto } from "./error-envelope.dto.ts";

export const OPENAPI_UI_PATH = "docs";
export const OPENAPI_JSON_PATH = "openapi.json";
export const OPENAPI_CONTRACT_PATH = fileURLToPath(new URL("../../../../../packages/contracts/http/openapi.v1.json", import.meta.url));

const OPENAPI_CONFIG = new DocumentBuilder()
  .setTitle("3MF Portal API")
  .setDescription("Versioned HTTP contract for the 3MF Portal backend")
  .setVersion("1.0")
  .addServer("/", "Current Portal API origin")
  .addCookieAuth("portal_session", { type: "apiKey", in: "cookie" }, "portal_session")
  .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearer")
  .build();

const OPENAPI_HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const CONTROLLER_SUFFIX = "Controller";

export function normalizeOpenApiOperationTags(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of OPENAPI_HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation?.tags === undefined) continue;

      const tags = [...new Set(operation.tags)];
      const controllerKey = operation.operationId?.split("_", 1)[0];
      const generatedControllerTag = controllerKey?.endsWith(CONTROLLER_SUFFIX) === true ? controllerKey.slice(0, -CONTROLLER_SUFFIX.length) : undefined;

      operation.tags = tags.length > 1 && generatedControllerTag !== undefined ? tags.filter((tag) => tag !== generatedControllerTag) : tags;
    }
  }
}

export function hardenProjectOpenApiSchemas(document: OpenAPIObject): void {
  const schemas = document.components?.schemas;
  if (schemas === undefined) return;
  const closed = new Set([
    "CreateProjectDto",
    "UpdateProjectDto",
    "SetPrimaryModelDto",
    "ProjectOwnerDto",
    "ModelSummaryDto",
    "ProjectSummaryDto",
    "ProjectDraftDto",
    "PublishedProjectDto",
    "ModelRevisionDto",
    "ProjectDraftResponseDto",
    "PublishedProjectResponseDto",
    "ProjectListResponseDto",
    "ModelResponseDto",
    "ModelListResponseDto",
    "ModelRevisionResponseDto",
    "ModelRevisionListResponseDto",
    "PublicationDto",
    "PublicationResponseDto",
    "BboxMmDto",
  ]);
  for (const name of closed) {
    const schema = schemas[name];
    if (schema !== undefined && !("$ref" in schema)) schema.additionalProperties = false;
  }
  const update = schemas.UpdateProjectDto;
  if (update !== undefined && !("$ref" in update)) update.minProperties = 1;
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(app, OPENAPI_CONFIG, {
    extraModels: [ApiErrorDto, ApiErrorEnvelopeDto],
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}`,
  });
  document.security ??= [];
  normalizeOpenApiOperationTags(document);
  hardenProjectOpenApiSchemas(document);
  return document;
}

export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function writeOpenApiContract(document: OpenAPIObject, contractPath = OPENAPI_CONTRACT_PATH): Promise<void> {
  await mkdir(dirname(contractPath), { recursive: true });
  const temporaryPath = `${contractPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, serializeOpenApiDocument(document), "utf8");
  await rename(temporaryPath, contractPath);
}

export function shouldWriteOpenApiContract(nodeEnvironment: string | undefined): boolean {
  return nodeEnvironment !== "production" && nodeEnvironment !== "test";
}

export function configureOpenApi(app: INestApplication): void {
  SwaggerModule.setup(OPENAPI_UI_PATH, app, createOpenApiDocument(app), {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
  });
}
