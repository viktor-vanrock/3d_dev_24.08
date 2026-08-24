import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMAND_CAPABILITY_NAMES, LIVE_AVAILABILITY_REASONS, resolveCommandCapabilities, resolveConnectionMode, resolveOperatingState } from "./contract.ts";

describe("printer operating contract", () => {
  it("maps unknown transport and capability values to safe defaults", () => {
    expect(resolveConnectionMode("managed-cloud", "connector")).toBe("list");
    expect(resolveCommandCapabilities({ commands: ["pause", "future-command"] })).toEqual({
      gcode: false,
      start: false,
      pause: true,
      resume: false,
      stop: false,
      cancel: false,
    });
    expect(
      resolveOperatingState({
        connection_mode: "managed-local",
        link_source: "ip",
        agent_id: null,
        agent_revoked_at: null,
        state_status: null,
        state_updated_at: null,
        capabilities: { commands: ["pause"] },
      }).command_capabilities.pause,
    ).toBe(false);
  });

  it.each([
    ["missing", { agent_id: null, state_status: null, state_updated_at: null }, "no_telemetry_channel"],
    ["offline", { agent_id: "agent", state_status: "offline", state_updated_at: new Date() }, "offline"],
    ["stale", { agent_id: "agent", state_status: "ready", state_updated_at: new Date(Date.now() - 60_000) }, "stale"],
    ["available", { agent_id: "agent", state_status: "ready", state_updated_at: new Date() }, "available"],
  ])("classifies %s state", (_name, state, reason) => {
    expect(
      resolveOperatingState({
        connection_mode: "managed-bridge",
        link_source: "agent",
        agent_revoked_at: null,
        capabilities: null,
        ...state,
      }).live_availability_reason,
    ).toBe(reason);
  });

  it("keeps the Fleet-backed fixture aligned with the public response shape", () => {
    const fixture = JSON.parse(readFileSync(new URL("../../../../../../docs/contracts/fixtures/printer.operating.v1.json", import.meta.url), "utf8")) as {
      response: Record<string, unknown>;
      negative_reasons: string[];
      guarantees: string[];
    };
    expect(fixture.response.connection_mode).toBe("managed-bridge");
    expect(fixture.response.live_availability_reason).toBe("available");
    expect(fixture.response.command_capabilities).toEqual(Object.fromEntries(COMMAND_CAPABILITY_NAMES.map((name) => [name, expect.any(Boolean)])));
    expect(fixture.negative_reasons).toEqual(expect.arrayContaining(LIVE_AVAILABILITY_REASONS.filter((reason) => reason !== "available")));
    expect(JSON.stringify(fixture.response)).not.toMatch(/lan_endpoint|token|credential|secret/i);
  });
});
