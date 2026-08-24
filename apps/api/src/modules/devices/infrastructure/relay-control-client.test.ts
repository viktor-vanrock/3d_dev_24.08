import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayControlClient } from "./relay-control-client.ts";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const logger = { warn: vi.fn() };
  const metrics = { incRelayPushClose: vi.fn() };
  return { metrics, client: new RelayControlClient(new ConfigService({ RELAY_INTERNAL_BASE_URL: "http://relay", RELAY_SERVICE_TOKEN: "token" }), logger as never, metrics as never) };
}

describe("RelayControlClient metrics", () => {
  it("counts every closed and disconnected agent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ closed: ["a", "b"], notConnected: ["c"] }) }));
    const { client, metrics } = setup();
    await client.closeAgentSessions(["a", "b", "c"], "agent_revoked");
    expect(metrics.incRelayPushClose).toHaveBeenCalledTimes(3);
    expect(metrics.incRelayPushClose).toHaveBeenCalledWith("sent");
    expect(metrics.incRelayPushClose).toHaveBeenCalledWith("agent_not_connected");
  });

  it("counts one transport failure for the whole call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { client, metrics } = setup();
    await client.closeAgentSessions(["a", "b"], "agent_revoked");
    expect(metrics.incRelayPushClose).toHaveBeenCalledOnce();
    expect(metrics.incRelayPushClose).toHaveBeenCalledWith("failed");
  });
});
