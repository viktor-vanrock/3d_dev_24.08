import { describe, expect, it } from "vitest";
import type { SessionSocket } from "./session-registry.ts";
import { SessionRegistry, type GatewaySession } from "./session-registry.ts";

class FakeSocket implements SessionSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly closes: Array<[number | undefined, string | undefined]> = [];
  send(data: string): void { this.sent.push(data); }
  close(code?: number, reason?: string): void { this.closes.push([code, reason]); this.readyState = 3; }
  terminate(): void { this.readyState = 3; }
}

function session(connectionId: string, generation: number, socket = new FakeSocket()): GatewaySession {
  return {
    gatewayId: "gateway-1",
    gatewayIdentity: "gateway-1",
    certificateFingerprintSha256: "a".repeat(64),
    sessionId: `session-${generation}`,
    sessionGeneration: generation,
    connectionId,
    socket,
    authorizationRevision: 1,
    authorizedDevices: new Map([["device-1", { device_id: "device-1" }]]),
    lastHeartbeatAt: 100,
    lastRevalidatedAt: 100,
    heartbeatTimeoutMs: 5_000,
    inflightFrames: 0,
    rateWindowStartedAt: 0,
    rateWindowCount: 0,
    closing: false,
  };
}

describe("SessionRegistry", () => {
  it("fences a replaced connection from heartbeat, removal and output", () => {
    const registry = new SessionRegistry();
    const old = session("old", 1);
    const current = session("current", 2);
    registry.install(old);
    expect(registry.install(current)).toBe(old);
    expect(() => registry.install(session("late-stale", 1))).toThrow("not newer");

    expect(registry.heartbeat(old, 500)).toBe(false);
    expect(registry.send(old, "stale")).toBe(false);
    expect(registry.remove(old)).toBeUndefined();
    expect(registry.current(current)).toBe(current);
    expect(registry.heartbeat(current, 500)).toBe(true);
  });

  it("isolates a slow session with bounded output buffers", () => {
    const registry = new SessionRegistry();
    registry.configure({ maxSessions: 2, maxInflightFrames: 2, maxInflightFramesPerSession: 1, maxFramesPerSecond: 10, maxBufferedBytes: 64, maxBufferedBytesPerSession: 32 });
    const slowSocket = new FakeSocket();
    slowSocket.bufferedAmount = 32;
    const slow = session("slow", 1, slowSocket);
    const fast = { ...session("fast", 1), gatewayId: "gateway-2", gatewayIdentity: "gateway-2" };
    registry.install(slow);
    registry.install(fast);

    expect(registry.send(slow, "x")).toBe(false);
    expect(registry.send(fast, "ok")).toBe(true);
    expect((fast.socket as FakeSocket).sent).toEqual(["ok"]);
  });

  it("bounds frame rate and concurrent work per session and globally", () => {
    const registry = new SessionRegistry();
    registry.configure({ maxSessions: 2, maxInflightFrames: 1, maxInflightFramesPerSession: 1, maxFramesPerSecond: 2, maxBufferedBytes: 64, maxBufferedBytesPerSession: 32 });
    const first = session("first", 1);
    const second = { ...session("second", 1), gatewayId: "gateway-2", gatewayIdentity: "gateway-2" };
    registry.install(first);
    registry.install(second);
    expect(registry.beginFrame(first, 1)).toBe("accepted");
    expect(registry.beginFrame(first, 2)).toBe("session_busy");
    expect(registry.beginFrame(second, 2)).toBe("global_busy");
    registry.endFrame(first);
    expect(registry.beginFrame(first, 3)).toBe("rate_limited");
  });
});
