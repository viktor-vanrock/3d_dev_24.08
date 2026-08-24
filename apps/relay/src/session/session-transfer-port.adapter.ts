import { Inject, Injectable } from "@nestjs/common";
import type { FileChunk, FileStart } from "@portal/contracts/device-protocol/v1";
import type { TransferSendOutcome, TransferSessionFence, TransferSessionPort } from "../transfers/transfer-session.port.ts";
import { SessionRegistry } from "./session-registry.ts";

@Injectable()
export class SessionTransferPortAdapter implements TransferSessionPort {
  constructor(@Inject(SessionRegistry) private readonly registry: SessionRegistry) {}

  isCurrent(session: TransferSessionFence): boolean {
    return this.registry.current(session) !== undefined;
  }

  authorizes(session: TransferSessionFence, deviceId: string): boolean {
    return this.registry.authorizes(session, deviceId);
  }

  sendFileStart(session: TransferSessionFence, frame: FileStart): TransferSendOutcome {
    return this.send(session, frame.device_id, JSON.stringify(frame));
  }

  sendFileChunk(session: TransferSessionFence, frame: FileChunk): TransferSendOutcome {
    return this.send(session, frame.device_id, JSON.stringify(frame));
  }

  private send(session: TransferSessionFence, deviceId: string, payload: string): TransferSendOutcome {
    if (!this.registry.current(session) || !this.registry.authorizes(session, deviceId)) return "unavailable";
    return this.registry.send(session, payload) ? "sent" : "backpressure";
  }
}
