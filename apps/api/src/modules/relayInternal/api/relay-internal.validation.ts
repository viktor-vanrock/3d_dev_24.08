import { Body, HttpStatus, Param, Query, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import openapi from "@portal/contracts/http/relay-internal.v1.openapi" with { type: "json" };
import { RelayInternalException } from "../domain/relay-internal.error.ts";

type Schema = Readonly<Record<string, unknown>>;

const canonicalSchemas: Readonly<Record<string, Schema>> = openapi.components.schemas;
const schemas: Readonly<Record<string, Schema>> = {
  ...canonicalSchemas,
  RelayTransferMetadataQueryDto: {
    type: "object",
    additionalProperties: false,
    required: ["session_id", "session_generation"],
    properties: {
      session_id: { $ref: "#/components/schemas/RelayIdentifier" },
      session_generation: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    },
  },
};

type RelaySchemaName =
  | "RelaySessionAuthorizeRequestDto"
  | "RelaySessionHeartbeatRequestDto"
  | "RelaySessionCloseRequestDto"
  | "RelayGatewaysRevalidateRequestDto"
  | "RelayCommandsClaimRequestDto"
  | "RelayCommandLeaseHeartbeatRequestDto"
  | "RelayCommandResultRequestDto"
  | "RelayTransferMetadataQueryDto"
  | "RelayTransferSourceUrlRequestDto"
  | "RelayTransferProgressRequestDto"
  | "RelayTransferResultRequestDto";

function schemaRef(ref: string): Schema | null {
  const name = ref.startsWith("#/components/schemas/") ? ref.slice("#/components/schemas/".length) : "";
  return schemas[name] ?? null;
}

function valid(schema: Schema, value: unknown): boolean {
  if (typeof schema.$ref === "string") {
    const resolved = schemaRef(schema.$ref);
    return resolved !== null && valid(resolved, value);
  }
  if ("const" in schema && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;

  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      const record = value as Readonly<Record<string, unknown>>;
      const properties = (schema.properties ?? {}) as Readonly<Record<string, Schema>>;
      const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
      if ([...required].some((name) => !(name in record))) return false;
      if (schema.additionalProperties === false && Object.keys(record).some((name) => !(name in properties))) return false;
      return Object.entries(record).every(([name, item]) => properties[name] === undefined || valid(properties[name], item));
    }
    case "array": {
      if (!Array.isArray(value)) return false;
      if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
      if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) return false;
      return typeof schema.items !== "object" || schema.items === null || value.every((item) => valid(schema.items as Schema, item));
    }
    case "string": {
      if (typeof value !== "string") return false;
      if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return false;
      if (schema.format === "date-time" && !Number.isFinite(Date.parse(value))) return false;
      if (schema.format === "uri") {
        try {
          new URL(value);
        } catch {
          return false;
        }
      }
      return true;
    }
    case "integer":
      return (
        Number.isSafeInteger(value) &&
        (typeof schema.minimum !== "number" || (value as number) >= schema.minimum) &&
        (typeof schema.maximum !== "number" || (value as number) <= schema.maximum)
      );
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

function normalizedQuery(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const query = { ...(value as Readonly<Record<string, unknown>>) };
  if (typeof query.session_generation === "string" && /^[1-9][0-9]*$/.test(query.session_generation)) {
    query.session_generation = Number(query.session_generation);
  }
  return query;
}

export class RelayInternalValidationPipe implements PipeTransform {
  constructor(
    private readonly schemaName: RelaySchemaName,
    private readonly query = false,
  ) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const normalized = this.query ? normalizedQuery(value) : value;
    const schema = schemas[this.schemaName];
    if (schema === undefined || !valid(schema, normalized)) {
      throw new RelayInternalException(HttpStatus.BAD_REQUEST, "relay.validation.invalid.v1", "Relay request does not match the v1 contract");
    }
    return normalized;
  }
}

export function RelayBody(schemaName: RelaySchemaName): ParameterDecorator {
  return Body(new RelayInternalValidationPipe(schemaName));
}

export function RelayQuery(schemaName: RelaySchemaName): ParameterDecorator {
  return Query(new RelayInternalValidationPipe(schemaName, true));
}

class RelayIdentifierPipe implements PipeTransform {
  transform(value: unknown, _metadata: ArgumentMetadata): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
      throw new RelayInternalException(HttpStatus.BAD_REQUEST, "relay.validation.invalid.v1", "Relay path identifier is invalid");
    }
    return value;
  }
}

export function RelayParam(name: string): ParameterDecorator {
  return Param(name, new RelayIdentifierPipe());
}
