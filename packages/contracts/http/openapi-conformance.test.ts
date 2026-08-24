import { describe, expect, it } from "vitest";
import openapi from "./openapi.v1.json" with { type: "json" };
import { API_ERROR_CODES } from "./error-envelope.ts";

// Гейт соответствия: сгенерированный `openapi.v1.json` (продюсер — фактический Nest AppModule,
// команда `pnpm --filter @portal/api openapi:generate`) обязан соответствовать source of truth
// в `@portal/contracts`, а не только собственной закоммиченной копии (её стережёт drift-гейт
// `openapi:check`). Здесь проверяется, что HTTP-контракт ошибок в OpenAPI ровно равен
// `error-envelope.ts`, и что КАЖДЫЙ объявленный 4xx/5xx ответ ссылается на versioned envelope
// (spec http-error-contract: «каждый ошибочный ответ SHALL иметь единую форму тела»).

interface OpenApiSchema {
  readonly $ref?: string;
  readonly type?: string;
  readonly format?: string;
  readonly additionalProperties?: boolean | OpenApiSchema;
  readonly enum?: readonly string[];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, OpenApiSchema>>;
  readonly items?: OpenApiSchema;
  readonly allOf?: readonly OpenApiSchema[];
  readonly oneOf?: readonly OpenApiSchema[];
  readonly anyOf?: readonly OpenApiSchema[];
}

interface OpenApiResponse {
  readonly content?: Readonly<Record<string, { readonly schema?: OpenApiSchema }>>;
  readonly headers?: Readonly<Record<string, { readonly schema?: OpenApiSchema }>>;
}

interface OpenApiParameter {
  readonly in?: string;
  readonly name?: string;
  readonly required?: boolean;
  readonly schema?: OpenApiSchema;
}

interface OpenApiOperation {
  readonly operationId?: string;
  readonly tags?: readonly string[];
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: {
    readonly content?: Readonly<Record<string, { readonly schema?: OpenApiSchema }>>;
  };
  readonly responses?: Readonly<Record<string, OpenApiResponse>>;
}

interface OpenApiPathItem extends Readonly<Record<string, OpenApiOperation | readonly OpenApiParameter[] | undefined>> {
  readonly parameters?: readonly OpenApiParameter[];
}

interface OpenApiDoc {
  readonly openapi: string;
  readonly components: { readonly schemas: Readonly<Record<string, OpenApiSchema>> };
  readonly paths: Readonly<Record<string, OpenApiPathItem>>;
}

const ENVELOPE_SCHEMA = "ApiErrorEnvelopeDto";
const ERROR_SCHEMA = "ApiErrorDto";
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

const doc = openapi as unknown as OpenApiDoc;

function isOperation(value: OpenApiOperation | readonly OpenApiParameter[] | undefined): value is OpenApiOperation {
  return value !== undefined && !Array.isArray(value);
}

function referencesEnvelope(schema: OpenApiSchema | undefined): boolean {
  if (schema === undefined) return false;
  if (schema.$ref === `#/components/schemas/${ENVELOPE_SCHEMA}`) return true;
  for (const branch of [schema.allOf, schema.oneOf, schema.anyOf]) {
    if (branch?.some(referencesEnvelope) === true) return true;
  }
  return false;
}

function schemaReferences(schema: OpenApiSchema | undefined, componentName: string): boolean {
  if (schema === undefined) return false;
  if (schema.$ref === `#/components/schemas/${componentName}`) return true;
  if (Object.values(schema.properties ?? {}).some((property) => schemaReferences(property, componentName))) return true;
  if (typeof schema.additionalProperties === "object" && schemaReferences(schema.additionalProperties, componentName)) return true;
  return [schema.allOf, schema.oneOf, schema.anyOf].some((branch) => branch?.some((item) => schemaReferences(item, componentName)) === true);
}

function isOpaqueObjectSchema(schema: OpenApiSchema | undefined): boolean {
  if (schema === undefined || schema.$ref !== undefined) return false;
  if (Object.keys(schema).length === 0) return true;
  if (schema.additionalProperties === true) return true;
  return schema.type === "object"
    && Object.keys(schema.properties ?? {}).length === 0
    && schema.additionalProperties === undefined
    && schema.allOf === undefined
    && schema.oneOf === undefined
    && schema.anyOf === undefined;
}

function containsOpaqueSchema(schema: OpenApiSchema | undefined): boolean {
  if (schema === undefined || schema.$ref !== undefined) return false;
  if (isOpaqueObjectSchema(schema)) return true;
  if (Object.values(schema.properties ?? {}).some(containsOpaqueSchema)) return true;
  if (containsOpaqueSchema(schema.items)) return true;
  if (typeof schema.additionalProperties === "object" && containsOpaqueSchema(schema.additionalProperties)) return true;
  return [schema.allOf, schema.oneOf, schema.anyOf]
    .some((branch) => branch?.some(containsOpaqueSchema) === true);
}

describe("openapi.v1.json conforms to @portal/contracts (api-error.v1)", () => {
  it("does not duplicate operations under generated controller and explicit domain tags", () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        const tags = operation.tags ?? [];
        const controllerKey = operation.operationId?.split("_", 1)[0];
        const generatedControllerTag = controllerKey?.endsWith("Controller") === true
          ? controllerKey.slice(0, -"Controller".length)
          : undefined;
        if (new Set(tags).size !== tags.length
          || (tags.length > 1 && generatedControllerTag !== undefined && tags.includes(generatedControllerTag))) {
          violations.push(`${method.toUpperCase()} ${path} → ${tags.join(", ")}`);
        }
      }
    }

    expect(violations, `operations duplicated across Swagger tags:\n${violations.join("\n")}`).toEqual([]);
  });

  it("declares the envelope and error schemas from the single source of truth", () => {
    const schemas = doc.components.schemas;
    expect(schemas[ENVELOPE_SCHEMA]).toBeDefined();
    expect(schemas[ERROR_SCHEMA]).toBeDefined();

    const envelope = schemas[ENVELOPE_SCHEMA]!;
    expect(envelope.required).toEqual(["error"]);
    expect(envelope.properties?.error?.$ref).toBe(`#/components/schemas/${ERROR_SCHEMA}`);

    const error = schemas[ERROR_SCHEMA]!;
    expect(error.required).toEqual(["code", "message", "requestId"]);
  });

  it("keeps ApiErrorDto.code enum exactly equal to API_ERROR_CODES", () => {
    const codeEnum = doc.components.schemas[ERROR_SCHEMA]?.properties?.code?.enum;
    expect(codeEnum).toBeDefined();
    // Идентичность множества И порядка: OpenAPI-код — буквальное отражение контракта.
    expect(codeEnum).toEqual([...API_ERROR_CODES]);
  });

  it("references the versioned envelope for every declared 4xx/5xx response", () => {
    const violations: string[] = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          const code = Number(status);
          if (!Number.isFinite(code) || code < 400) continue;
          const schema = response.content?.["application/json"]?.schema;
          if (!referencesEnvelope(schema)) {
            violations.push(`${method.toUpperCase()} ${path} → ${status}`);
          }
        }
      }
    }
    expect(violations, `error responses missing ${ENVELOPE_SCHEMA}:\n${violations.join("\n")}`).toEqual([]);
  });

  it("declares at least one error response referencing the envelope (gate is live)", () => {
    let referencing = 0;
    for (const methods of Object.values(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          if (Number(status) < 400) continue;
          if (referencesEnvelope(response.content?.["application/json"]?.schema)) referencing++;
        }
      }
    }
    expect(referencing).toBeGreaterThan(0);
  });

  it("does not publish empty object component schemas", () => {
    const emptySchemas = Object.entries(doc.components.schemas)
      .filter(([, schema]) => containsOpaqueSchema(schema))
      .map(([name]) => name);

    expect(emptySchemas, `empty object schemas:\n${emptySchemas.join("\n")}`).toEqual([]);
  });

  it("declares every templated path parameter on every operation", () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      const templateNames = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
      if (templateNames.length === 0) continue;

      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
        for (const name of templateNames) {
          const parameter = parameters.find((candidate) => candidate.in === "path" && candidate.name === name);
          if (parameter?.required !== true || parameter.schema === undefined) {
            violations.push(`${method.toUpperCase()} ${path} → {${name}}`);
          }
        }
      }
    }

    expect(violations, `missing path parameter schemas:\n${violations.join("\n")}`).toEqual([]);
  });

  it("publishes a schema for every successful response with a body", () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          const code = Number(status);
          if (!Number.isFinite(code) || code < 200 || code >= 300 || code === 204 || code === 205) continue;
          const schemas = Object.values(response.content ?? {}).map((media) => media.schema);
          if (schemas.length === 0 || schemas.some((schema) => schema === undefined)) {
            violations.push(`${method.toUpperCase()} ${path} → ${status}`);
          }
        }
      }
    }

    expect(violations, `success responses missing schemas:\n${violations.join("\n")}`).toEqual([]);
  });

  it("does not publish ApiJsonValue or another opaque success JSON schema", () => {
    const violations: string[] = [];
    expect(doc.components.schemas.ApiJsonValue, "ApiJsonValue component must be removed").toBeUndefined();

    for (const [path, pathItem] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          const code = Number(status);
          if (!Number.isFinite(code) || code < 200 || code >= 300) continue;
          for (const [mediaType, media] of Object.entries(response.content ?? {})) {
            if (!mediaType.includes("json")) continue;
            if (schemaReferences(media.schema, "ApiJsonValue") || containsOpaqueSchema(media.schema)) {
              violations.push(`${method.toUpperCase()} ${path} → ${status} ${mediaType}`);
            }
          }
        }
      }
    }

    expect(violations, `opaque success JSON schemas:\n${violations.join("\n")}`).toEqual([]);
  });

  it("publishes schemas for every declared request body", () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        if (operation.requestBody === undefined) continue;
        const media = Object.entries(operation.requestBody.content ?? {});
        if (media.length === 0 || media.some(([, value]) => value.schema === undefined || containsOpaqueSchema(value.schema))) {
          violations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(violations, `request bodies missing concrete schemas:\n${violations.join("\n")}`).toEqual([]);
  });

  it("does not attach a body schema to 204/205 responses", () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        for (const status of ["204", "205"]) {
          if (Object.keys(operation.responses?.[status]?.content ?? {}).length > 0) {
            violations.push(`${method.toUpperCase()} ${path} → ${status}`);
          }
        }
      }
    }
    expect(violations, `body declared for no-content responses:\n${violations.join("\n")}`).toEqual([]);
  });

  it("declares a Location header for every redirect response", () => {
    const violations: string[] = [];
    for (const [path, pathItem] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method) || !isOperation(operation)) continue;
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          if (!/^3(?:0[1278]|03)$/.test(status)) continue;
          const location = response.headers?.Location ?? response.headers?.location;
          if (location?.schema === undefined) violations.push(`${method.toUpperCase()} ${path} → ${status}`);
        }
      }
    }
    expect(violations, `redirect responses missing Location header:\n${violations.join("\n")}`).toEqual([]);
  });
});
