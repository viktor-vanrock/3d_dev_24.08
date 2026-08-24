import { register } from "prom-client";
import { describe, expect, it } from "vitest";
import { MetricsService } from "./metrics.service.ts";

describe("MetricsService", () => {
  it("increments the three bounded counters in a private registry", async () => {
    const metrics = new MetricsService();
    metrics.incRevokedCredentialUse("session", "version_mismatch");
    metrics.incCredentialRevocation("device_agent", "cascade_ban");
    metrics.incRelayPushClose("sent");

    const output = await metrics.metrics();
    expect(output).toContain('revoked_credential_use_total{credential_type="session",reason="version_mismatch"} 1');
    expect(output).toContain('credential_revocations_total{credential_type="device_agent",trigger="cascade_ban"} 1');
    expect(output).toContain('relay_push_close_total{outcome="sent"} 1');
    expect(await register.metrics()).not.toContain("revoked_credential_use_total");
  });
});
