import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import document from "./relay-internal.v1.openapi.json" with { type: "json" };
import { RELAY_INTERNAL_V1_NAMED_DTOS } from "./relay-internal.v1.dto.ts";
import { RELAY_INTERNAL_V1_OPERATIONS } from "./relay-internal.v1.ts";

type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}

const HTTP_METHODS = new Set(["get", "post", "put"]);
const ROOT = document as JsonObject;

function objectValue(value: JsonValue | undefined): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function arrayValue(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function resolveReference(reference: string): JsonValue | undefined {
  if (!reference.startsWith("#/")) return undefined;
  return reference.slice(2).split("/").reduce<JsonValue | undefined>((value, segment) => objectValue(value)?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], ROOT);
}

function visit(value: JsonValue, path: string, callback: (object: JsonObject, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, callback));
    return;
  }
  const object = objectValue(value);
  if (object === undefined) return;
  callback(object, path);
  Object.entries(object).forEach(([key, child]) => visit(child, `${path}.${key}`, callback));
}

function operations(): readonly { readonly path: string; readonly method: string; readonly operation: JsonObject }[] {
  const paths = objectValue(ROOT.paths) ?? {};
  return Object.entries(paths).flatMap(([path, item]) => Object.entries(objectValue(item) ?? {})
    .filter(([method]) => HTTP_METHODS.has(method))
    .map(([method, operation]) => ({ path, method, operation: objectValue(operation)! })));
}

function responseSchema(operation: JsonObject, status: string): JsonObject | undefined {
  const response = objectValue(objectValue(operation.responses)?.[status]);
  const resolvedResponse = typeof response?.$ref === "string" ? objectValue(resolveReference(response.$ref)) : response;
  const media = objectValue(objectValue(resolvedResponse?.content)?.["application/json"]);
  return objectValue(media?.schema);
}

describe("relay internal v1 OpenAPI contract", () => {
  it("matches the canonical operation inventory and has named DTO coverage", () => {
    const actual = operations().map(({ method, operation, path }) => `${String(operation.operationId)} ${method.toUpperCase()} ${path}`).sort();
    const expected = RELAY_INTERNAL_V1_OPERATIONS.map(({ method, operationId, path }) => `${operationId} ${method} ${path}`).sort();
    expect(actual).toEqual(expected);
    expect(Object.keys(RELAY_INTERNAL_V1_NAMED_DTOS).sort()).toEqual(RELAY_INTERNAL_V1_OPERATIONS.map(({ operationId }) => operationId).sort());
    expect(Object.values(RELAY_INTERNAL_V1_NAMED_DTOS).every((names) => names.length >= 3)).toBe(true);
  });

  it("resolves every local reference", () => {
    const unresolved: string[] = [];
    visit(ROOT, "$", (object, path) => {
      if (typeof object.$ref === "string" && resolveReference(object.$ref) === undefined) unresolved.push(`${path}: ${object.$ref}`);
    });
    expect(unresolved).toEqual([]);
  });

  it("uses only the relay service credential and echoes correlation on every response", () => {
    expect(ROOT.security).toEqual([{ relayServiceCredential: [] }]);
    const scheme = objectValue(objectValue(objectValue(ROOT.components)?.securitySchemes)?.relayServiceCredential);
    expect(scheme).toMatchObject({ type: "apiKey", in: "header", name: "x-relay-service-token" });

    const violations: string[] = [];
    for (const { method, operation, path } of operations()) {
      for (const [status, rawResponse] of Object.entries(objectValue(operation.responses) ?? {})) {
        const response = objectValue(rawResponse)!;
        const resolved = typeof response.$ref === "string" ? objectValue(resolveReference(response.$ref))! : response;
        const correlation = objectValue(objectValue(resolved.headers)?.["x-correlation-id"]);
        if (correlation?.$ref !== "#/components/headers/RelayCorrelationId") violations.push(`${method} ${path}: ${status}`);
      }
    }
    expect(violations).toEqual([]);

    const sourceUrl = operations().find(({ operation }) => operation.operationId === "relayTransferSourceUrl")!.operation;
    const rawSourceResponse = objectValue(objectValue(sourceUrl.responses)?.["200"])!;
    const sourceResponse = objectValue(resolveReference(String(rawSourceResponse.$ref)))!;
    expect(objectValue(objectValue(sourceResponse.headers)?.["cache-control"])?.$ref).toBe("#/components/headers/RelayNoStore");
  });

  it("rejects opaque, unbounded and fallback payload schemas", () => {
    const violations: string[] = [];
    visit(ROOT, "$", (object, path) => {
      const keys = Object.keys(object);
      if (keys.length === 0) violations.push(`${path}: empty object`);
      if (object.additionalProperties === true) violations.push(`${path}: unrestricted object`);
      if (object.type === "object" && object.additionalProperties !== false && object.properties !== undefined) violations.push(`${path}: object is not closed`);
      if (object.type === "array" && (object.items === undefined || object.maxItems === undefined)) violations.push(`${path}: unbounded array`);
      if (object.type === "string" && object.maxLength === undefined && object.enum === undefined && object.const === undefined && object.format === undefined && object.pattern === undefined) violations.push(`${path}: unbounded string`);
    });
    expect(violations).toEqual([]);
  });

  it("requires concrete success and safe error bodies for every operation", () => {
    const violations: string[] = [];
    for (const { method, operation, path } of operations()) {
      const success = responseSchema(operation, "200");
      if (typeof success?.$ref !== "string" || resolveReference(success.$ref) === undefined) violations.push(`${method} ${path}: missing concrete 200 schema`);
      const errors = Object.entries(objectValue(operation.responses) ?? {}).filter(([status]) => Number(status) >= 400);
      if (errors.length === 0) violations.push(`${method} ${path}: no safe errors`);
      for (const [status] of errors) {
        const schema = responseSchema(operation, status);
        if (schema?.$ref !== "#/components/schemas/RelayInternalErrorEnvelopeDto") violations.push(`${method} ${path}: unsafe ${status} schema`);
      }
      if (objectValue(operation.responses)?.default !== undefined) violations.push(`${method} ${path}: fallback response`);
    }
    expect(violations).toEqual([]);
  });

  it("types required headers, path/query parameters and every mutation body", () => {
    const violations: string[] = [];
    for (const { method, operation, path } of operations()) {
      const parameters = arrayValue(operation.parameters).map((item) => {
        const parameter = objectValue(item)!;
        return typeof parameter.$ref === "string" ? objectValue(resolveReference(parameter.$ref))! : parameter;
      });
      for (const requiredHeader of ["x-relay-service-token", "x-correlation-id"]) {
        if (!parameters.some((parameter) => parameter.in === "header" && parameter.name === requiredHeader && parameter.required === true && parameter.schema !== undefined)) violations.push(`${method} ${path}: ${requiredHeader}`);
      }
      const operationIdRequired = method !== "get" && operation.operationId !== "relayGatewaysRevalidate";
      if (operationIdRequired && !parameters.some((parameter) => parameter.in === "header" && parameter.name === "x-operation-id" && parameter.required === true)) violations.push(`${method} ${path}: x-operation-id`);
      for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)) {
        if (!parameters.some((parameter) => parameter.in === "path" && parameter.name === name && parameter.required === true && parameter.schema !== undefined)) violations.push(`${method} ${path}: {${name}}`);
      }
      if (method !== "get") {
        const body = objectValue(operation.requestBody);
        if (typeof body?.$ref !== "string" || resolveReference(body.$ref) === undefined) violations.push(`${method} ${path}: request body`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not emit permissive language-level DTOs", () => {
    const directory = fileURLToPath(new URL(".", import.meta.url));
    const sources = ["relay-internal.v1.dto.ts", "generated/relay-internal.v1.ts", "generated/relay-internal.v1.client.ts"]
      .map((name) => readFileSync(`${directory}/${name}`, "utf8"));
    expect(sources.join("\n")).not.toMatch(/(?:\:\s*(?:any|unknown)\b|\bas\s+(?:any|unknown)\b)/);
  });

  it("keeps generated client, named aliases and rendered documentation in the drift gate", () => {
    const directory = fileURLToPath(new URL(".", import.meta.url));
    const aliases = readFileSync(`${directory}/relay-internal.v1.dto.ts`, "utf8");
    const client = readFileSync(`${directory}/generated/relay-internal.v1.client.ts`, "utf8");
    const documentation = readFileSync(`${directory}/generated/relay-internal.v1.md`, "utf8");
    expect(aliases).not.toMatch(/export interface Relay(?:Session|Gateway|Command|Transfer)/);
    for (const { operationId } of RELAY_INTERNAL_V1_OPERATIONS) {
      expect(client).toContain(`${operationId}(input:`);
      expect(documentation).toContain(`| \`${operationId}\` |`);
    }
  });
});
