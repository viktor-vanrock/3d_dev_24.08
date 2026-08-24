import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../runtime/agentRuntime.ts";
import { applyRelayLifecycleEvent } from "./runtimeLifecycle.ts";

describe("Relay lifecycle integration", () => {
  it("keeps admission closed through handshake and opens only on current hello_ack", () => {
    const runtime = new AgentRuntime({ version: "1.2.3", commitSha: "abcdef1" });
    runtime.update({ moonraker: "ready" });
    const stop = vi.fn();
    applyRelayLifecycleEvent(runtime, { type: "connecting", generation: 2 }, stop);
    applyRelayLifecycleEvent(runtime, { type: "socket_open", generation: 2 }, stop);
    applyRelayLifecycleEvent(runtime, { type: "hello_challenge", generation: 2 }, stop);
    expect(runtime.snapshot).toMatchObject({ status: "degraded", admission: "closed", relayGeneration: 2 });
    applyRelayLifecycleEvent(runtime, { type: "hello_ack", generation: 1 }, stop);
    expect(runtime.snapshot.admission).toBe("closed");
    applyRelayLifecycleEvent(runtime, { type: "hello_ack", generation: 2 }, stop);
    expect(runtime.snapshot).toMatchObject({ status: "healthy", admission: "open", relay: "ready" });
  });

  it("closes admission on disconnect, rejection and revoke, and stops reconnect after revoke", () => {
    const runtime = new AgentRuntime({ version: "1.2.3", commitSha: "abcdef1" });
    runtime.update({ moonraker: "ready" });
    const stop = vi.fn();
    applyRelayLifecycleEvent(runtime, { type: "hello_ack", generation: 1 }, stop);
    applyRelayLifecycleEvent(runtime, { type: "disconnected", generation: 1, code: 1006 }, stop);
    expect(runtime.snapshot).toMatchObject({ status: "degraded", admission: "closed", reasonCode: "relay_disconnected" });
    applyRelayLifecycleEvent(runtime, { type: "authorization_rejected", generation: 2 }, stop);
    expect(runtime.snapshot).toMatchObject({ admission: "closed", reasonCode: "relay_authorization_rejected" });
    applyRelayLifecycleEvent(runtime, { type: "revoked", generation: 2 }, stop);
    expect(runtime.snapshot).toMatchObject({ status: "revoked", admission: "closed", reasonCode: "gateway_revoked" });
    expect(stop).toHaveBeenCalledOnce();
  });
});
