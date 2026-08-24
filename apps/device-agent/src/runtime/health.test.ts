import { describe, expect, it } from "vitest";

import { AgentRuntime } from "./agentRuntime.ts";
import { projectHealth } from "./health.ts";

describe("health.v1 projection", () => {
  it("reports separate Relay and Moonraker substates without secrets", () => {
    const runtime = new AgentRuntime({ version: "1.2.3", commitSha: "abcdef1" });
    runtime.update({ moonraker: "ready", status: "degraded", reasonCode: "relay_not_configured" });
    expect(projectHealth(runtime.snapshot)).toEqual({
      version: "health.v1",
      status: "degraded",
      revision: 1,
      agent_version: "1.2.3",
      agent_commit_sha: "abcdef1",
      reason_code: "relay_not_configured",
      moonraker: { state: "ready" },
      relay: { state: "not_configured", connection_generation: null },
    });
  });
});

