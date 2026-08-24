import { describe, expect, it } from "vitest";
import type { GatewaySession, SessionSocket } from "./session-registry.ts";
import { SessionRegistry } from "./session-registry.ts";
import { SessionTransferPortAdapter } from "./session-transfer-port.adapter.ts";

class FakeSocket implements SessionSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  terminate(): void { this.readyState = 3; }
}

describe("SessionTransferPortAdapter", () => {
  it("maps current authorized bounded sends to transfer outcomes", () => {
    const registry = new SessionRegistry();
    registry.configure({ maxSessions: 1, maxInflightFrames: 1, maxInflightFramesPerSession: 1, maxFramesPerSecond: 10, maxBufferedBytes: 2_048, maxBufferedBytesPerSession: 1_024 });
    const socket = new FakeSocket();
    const session: GatewaySession = {
      gatewayId: "gateway-1", gatewayIdentity: "gateway-1", certificateFingerprintSha256: "a".repeat(64),
      sessionId: "session-1", sessionGeneration: 1, connectionId: "connection-1", socket,
      authorizationRevision: 1, authorizedDevices: new Map([["device-1", { device_id: "device-1" }]]),
      lastHeartbeatAt: 1, lastRevalidatedAt: 1, heartbeatTimeoutMs: 5_000, inflightFrames: 0,
      rateWindowStartedAt: 1, rateWindowCount: 0, closing: false,
    };
    registry.install(session);
    const adapter = new SessionTransferPortAdapter(registry);
    const frame = { type: "file_start", device_id: "device-1", transfer_id: "transfer-1", file_name: "part.gcode", size_bytes: 4, sha256: "a".repeat(64), object_version: "v1", kind: "gcode", start_print: false, chunk_size_bytes: 4 } as const;
    expect(adapter.sendFileStart(session, frame)).toBe("sent");
    socket.bufferedAmount = 1_024;
    expect(adapter.sendFileStart(session, frame)).toBe("backpressure");
    expect(adapter.sendFileStart(session, { ...frame, device_id: "foreign" })).toBe("unavailable");
  });
});
