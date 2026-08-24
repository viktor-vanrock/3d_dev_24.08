/**
 * Target relay wire contract. All frame shapes and runtime validators come from
 * the canonical schema package; this consumer must not redeclare transport DTOs.
 */
export type {
  Capability,
  Command,
  CommandAck,
  CommandResult,
  DeviceStatus,
  Error,
  FileChunk,
  FileChunkAck,
  FileResult,
  FileStart,
  FileStartAck,
  GatewayToRelayFrame,
  Heartbeat,
  HeartbeatAck,
  Hello,
  HelloAck,
  HelloChallenge,
  RelayToGatewayFrame,
} from "@portal/contracts/device-protocol/v1";

export { deviceProtocolV1ErrorCodes, deviceProtocolV1Limits, parseGatewayToRelayFrame, parseRelayToGatewayFrame } from "@portal/contracts/device-protocol/v1";
