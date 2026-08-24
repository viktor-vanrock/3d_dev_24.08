import { describe, expect, it, vi } from "vitest";
import { GatewayRuntime } from "./gateway-runtime.service.ts";

describe("GatewayRuntime.closeSessions", () => {
  it("closes connected gateways and is idempotent for absent sessions", async () => {
    const session = { closing: false, gatewayId: "11111111-1111-4111-8111-111111111111" };
    const runtime = Object.create(GatewayRuntime.prototype) as GatewayRuntime;
    const internals = runtime as unknown as { registry: { get: ReturnType<typeof vi.fn> }; closeSession: ReturnType<typeof vi.fn> };
    internals.registry = { get: vi.fn().mockReturnValue(session) };
    internals.closeSession = vi.fn().mockImplementation(async () => { session.closing = true; });

    await expect(runtime.closeSessions([session.gatewayId, "22222222-2222-4222-8222-222222222222"], "agent_revoked")).resolves.toEqual({
      closed: [session.gatewayId],
      notConnected: ["22222222-2222-4222-8222-222222222222"],
    });
    await expect(runtime.closeSessions([session.gatewayId], "agent_revoked")).resolves.toEqual({ closed: [], notConnected: [session.gatewayId] });
  });
});
