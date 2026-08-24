import type { FileChunk, FileStart } from "@portal/contracts/device-protocol/v1";

export const TRANSFER_SESSION_PORT = Symbol("TRANSFER_SESSION_PORT");

export interface TransferSessionFence {
  readonly gatewayId: string;
  readonly sessionId: string;
  readonly sessionGeneration: number;
  readonly connectionId: string;
}

export type TransferSendOutcome = "sent" | "unavailable" | "backpressure";

/**
 * Gateway transport boundary used by file delivery. Implementations must resolve
 * send only after the transport has accepted the frame under its buffer limits.
 */
export interface TransferSessionPort {
  isCurrent(session: TransferSessionFence): boolean;
  authorizes(session: TransferSessionFence, deviceId: string): boolean;
  sendFileStart(session: TransferSessionFence, frame: FileStart): TransferSendOutcome | Promise<TransferSendOutcome>;
  sendFileChunk(session: TransferSessionFence, frame: FileChunk): TransferSendOutcome | Promise<TransferSendOutcome>;
}
