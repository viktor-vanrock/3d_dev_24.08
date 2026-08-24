import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import errorCodes from "./error-codes.json" with { type: "json" };
import limits from "./limits.json" with { type: "json" };
import schema from "./schema.json" with { type: "json" };
import type { GatewayToRelayFrame, RelayToGatewayFrame } from "./generated.ts";

export type WireErrorCode = (typeof errorCodes.wire)[number];

export type FrameValidationResult<T> =
  | { readonly ok: true; readonly frame: T }
  | { readonly ok: false; readonly error: WireErrorCode };

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemaDefinitions = schema.$defs;

function compile(definition: "gatewayToRelayFrame" | "relayToGatewayFrame"): ValidateFunction {
  return ajv.compile({
    $schema: schema.$schema,
    $defs: schemaDefinitions,
    $ref: `#/$defs/${definition}`,
  });
}

const validateGatewayValue = compile("gatewayToRelayFrame");
const validateRelayValue = compile("relayToGatewayFrame");

const gatewayFrameTypes = new Set(["hello", "heartbeat", "command_ack", "command_result", "file_start_ack", "file_chunk_ack", "file_result"]);
const relayFrameTypes = new Set(["hello_challenge", "hello_ack", "heartbeat_ack", "command", "file_start", "file_chunk", "error"]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFrame<T>(raw: string, frameTypes: ReadonlySet<string>, validator: ValidateFunction<T>): FrameValidationResult<T> {
  if (new TextEncoder().encode(raw).byteLength > limits.max_text_frame_bytes) return { ok: false, error: "frame_too_large" };

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: "invalid_frame" };
  }
  if (!isRecord(value) || typeof value.type !== "string") return { ok: false, error: "invalid_frame" };
  if (!frameTypes.has(value.type)) return { ok: false, error: "unknown_frame_type" };
  if (value.type === "hello" && value.protocol_version !== "v1") {
    return typeof value.protocol_version === "string"
      ? { ok: false, error: "unsupported_version" }
      : { ok: false, error: "invalid_frame" };
  }
  return validator(value) ? { ok: true, frame: value } : { ok: false, error: "invalid_frame" };
}

export function parseGatewayToRelayFrame(raw: string): FrameValidationResult<GatewayToRelayFrame> {
  return parseFrame(raw, gatewayFrameTypes, validateGatewayValue as ValidateFunction<GatewayToRelayFrame>);
}

export function parseRelayToGatewayFrame(raw: string): FrameValidationResult<RelayToGatewayFrame> {
  return parseFrame(raw, relayFrameTypes, validateRelayValue as ValidateFunction<RelayToGatewayFrame>);
}

export function isGatewayToRelayFrame(value: unknown): value is GatewayToRelayFrame {
  return validateGatewayValue(value);
}

export function isRelayToGatewayFrame(value: unknown): value is RelayToGatewayFrame {
  return validateRelayValue(value);
}

export function validationErrors(direction: "gateway_to_relay" | "relay_to_gateway"): readonly ErrorObject[] {
  const errors = direction === "gateway_to_relay" ? validateGatewayValue.errors : validateRelayValue.errors;
  return errors ?? [];
}
