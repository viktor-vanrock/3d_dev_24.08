import { describe, expect, it } from "vitest";
import { RelayMetrics } from "./metrics.service.ts";

describe("RelayMetrics", () => {
  it("renders the required bounded operational metrics", () => {
    const metrics = new RelayMetrics();
    metrics.sessionOpened();
    metrics.recordAuth("authorized");
    metrics.recordHeartbeat("accepted");
    metrics.recordProtocol("gateway_to_relay", "accepted", "heartbeat");
    metrics.recordBackpressure("session", "paused");
    metrics.recordCommand("claimed", "accepted");

    const output = metrics.render();
    expect(output).toContain("relay_active_sessions 1");
    expect(output).toContain('relay_auth_total{outcome="authorized"} 1');
    expect(output).toContain('relay_heartbeat_total{outcome="accepted"} 1');
    expect(output).toContain('relay_protocol_frames_total{direction="gateway_to_relay",frame_type="heartbeat",outcome="accepted"} 1');
    expect(output).toContain('relay_backpressure_total{outcome="paused",scope="session"} 1');
    expect(output).toContain('relay_command_lifecycle_total{outcome="accepted",state="claimed"} 1');
  });

  it("never lets the active-session gauge become negative", () => {
    const metrics = new RelayMetrics();
    metrics.sessionClosed();
    expect(metrics.render()).toContain("relay_active_sessions 0");
  });
});
