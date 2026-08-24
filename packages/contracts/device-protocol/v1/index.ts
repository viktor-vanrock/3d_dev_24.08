export type * from "./generated.ts";
export {
  isGatewayToRelayFrame,
  isRelayToGatewayFrame,
  parseGatewayToRelayFrame,
  parseRelayToGatewayFrame,
  validationErrors,
  type FrameValidationResult,
  type WireErrorCode,
} from "./runtime.ts";

export { default as deviceProtocolV1Schema } from "./schema.json" with { type: "json" };
export { default as deviceProtocolV1Limits } from "./limits.json" with { type: "json" };
export { default as deviceProtocolV1ErrorCodes } from "./error-codes.json" with { type: "json" };
