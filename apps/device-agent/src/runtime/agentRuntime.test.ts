import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./agentRuntime.ts";

describe("AgentRuntime", () => {
  it("keeps monotonic revisions and does not become healthy before relay readiness", () => {
    const runtime = new AgentRuntime({ version: "1.2.3", commitSha: "abcdef1" });
    runtime.update({ moonraker: "ready" });
    runtime.update({ admission: "open" });
    expect(runtime.healthyIfReady().status).toBe("degraded");
    runtime.update({ relay: "ready" });
    expect(runtime.healthyIfReady().status).toBe("healthy");
    expect(runtime.snapshot.revision).toBeGreaterThan(0);
  });

  it("closes admission while blocked or stopping", () => {
    const runtime = new AgentRuntime();
    runtime.update({ status: "blocked_config", reasonCode: "invalid_config" });
    expect(runtime.snapshot.admission).toBe("closed");
    runtime.update({ shutdown: "stopping" });
    expect(runtime.snapshot.shutdown).toBe("stopping");
  });

  it("ignores completed Relay generations", () => {
    const runtime = new AgentRuntime();
    runtime.updateRelay(2, { relay: "ready", admission: "open" });
    const revision = runtime.snapshot.revision;
    runtime.updateRelay(1, { relay: "down", admission: "closed", reasonCode: "stale" });
    expect(runtime.snapshot).toMatchObject({ revision, relayGeneration: 2, relay: "ready", admission: "open" });
  });
});
