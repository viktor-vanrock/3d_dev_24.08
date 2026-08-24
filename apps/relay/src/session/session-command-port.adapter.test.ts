import { describe, expect, it } from "vitest";
import type { GatewaySession, SessionSocket } from "./session-registry.ts";
import { SessionRegistry } from "./session-registry.ts";
import { SessionCommandPortAdapter } from "./session-command-port.adapter.ts";

class FakeSocket implements SessionSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  terminate(): void { this.readyState = 3; }
}

describe("SessionCommandPortAdapter", () => {
  it("exposes only current authorization and refuses cross-device command output", () => {
    const registry = new SessionRegistry();
    const socket = new FakeSocket();
    const session: GatewaySession = {
      gatewayId: "gateway-1", gatewayIdentity: "gateway-1", certificateFingerprintSha256: "a".repeat(64),
      sessionId: "session-1", sessionGeneration: 1, connectionId: "connection-1", socket,
      authorizationRevision: 3, authorizedDevices: new Map([["device-1", { device_id: "device-1" }]]),
      lastHeartbeatAt: 1, lastRevalidatedAt: 1, heartbeatTimeoutMs: 5_000, inflightFrames: 0,
      rateWindowStartedAt: 1, rateWindowCount: 0, closing: false,
    };
    registry.install(session);
    const adapter = new SessionCommandPortAdapter(registry);
    expect(adapter.listLiveAuthorizedSessions()).toEqual([{
      gatewayId: "gateway-1", sessionId: "session-1", sessionGeneration: 1,
      connectionId: "connection-1", authorizationRevision: 3, authorizedDeviceIds: ["device-1"],
    }]);
    expect(adapter.sendCommand(session, { type: "command", device_id: "foreign", command_id: "command-1", command_seq: 1, command: "pause", command_token: "token", payload: {} })).toBe(false);
    expect(adapter.sendCommand(session, { type: "command", device_id: "device-1", command_id: "command-1", command_seq: 1, command: "pause", command_token: "token", payload: {} })).toBe(true);
    expect(socket.sent).toHaveLength(1);
  });
});
