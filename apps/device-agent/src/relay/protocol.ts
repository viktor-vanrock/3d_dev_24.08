import type { DeviceIdentityV1 } from "../identity.ts";
import type { Capability, Command, CommandResult, DeviceStatus, FileChunk, FileChunkAck, FileResult, FileStart, FileStartAck } from "./protocol-v1.ts";

/** Local device snapshot. RelayClient maps it to the canonical v1 wire shape. */
export interface HeartbeatDeviceUpdate {
  id: string;
  status: DeviceStatus;
  seq?: number;
  progress?: number | null;
  metrics?: Readonly<Record<string, number | string | boolean | null>>;
  identity?: DeviceIdentityV1;
}

export type DeviceCommand = Command["command"];
export type CommandFrame = Command;
export type CommandTerminalFrame = CommandResult;
export type FileStartFrame = FileStart;
export type FileChunkFrame = FileChunk;
export type FileStartAckFrame = FileStartAck;
export type FileChunkAckFrame = FileChunkAck;
export type FileResultFrame = FileResult;
export type FileTransferKind = FileStart["kind"];
export type ProtocolCapability = Capability;
export type CommandResultFrame = CommandResult;
