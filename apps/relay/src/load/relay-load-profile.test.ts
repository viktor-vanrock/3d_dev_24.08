import { describe, expect, it } from "vitest";
import { RELAY_LOAD_PROFILE, runRelayLoadProfile } from "./relay-load-profile.ts";

describe("relay bounded CI load profile", () => {
  it("keeps admission, heartbeat, event loop and memory bounded while isolating a slow session", async () => {
    const result = await runRelayLoadProfile();

    console.info(`RELAY_LOAD_EVIDENCE ${JSON.stringify(result)}`);

    expect(result.profile).toEqual({
      sessions: RELAY_LOAD_PROFILE.sessionCount,
      admittedFrames: RELAY_LOAD_PROFILE.sessionCount * RELAY_LOAD_PROFILE.framesPerSession,
      heartbeats: RELAY_LOAD_PROFILE.sessionCount * RELAY_LOAD_PROFILE.framesPerSession,
      payloadBytes: RELAY_LOAD_PROFILE.payloadBytes,
      slowSessions: 1,
    });
    expect(result.latencyMs.admissionP95).toBeLessThanOrEqual(RELAY_LOAD_PROFILE.thresholds.admissionP95Ms);
    expect(result.latencyMs.heartbeatP95).toBeLessThanOrEqual(RELAY_LOAD_PROFILE.thresholds.heartbeatP95Ms);
    expect(result.eventLoopDelayMs.p95).toBeLessThanOrEqual(RELAY_LOAD_PROFILE.thresholds.eventLoopP95Ms);
    expect(result.eventLoopDelayMs.max).toBeLessThanOrEqual(RELAY_LOAD_PROFILE.thresholds.eventLoopMaxMs);
    expect(result.memory.rssDeltaBytes).toBeLessThanOrEqual(RELAY_LOAD_PROFILE.thresholds.rssDeltaBytes);
    expect(result.backpressure).toEqual({
      slowRejected: true,
      fastDeliveredWhileSlow: true,
      slowRecovered: true,
    });
    expect(result.durationMs).toBeLessThanOrEqual(RELAY_LOAD_PROFILE.thresholds.durationMs);
  }, 20_000);
});
