import { describe, expect, it } from "vitest";
import { loadRelayConfig } from "./relay-config.ts";

const BASE_ENV = {
  RELAY_API_BASE_URL: "http://127.0.0.1:3000",
  RELAY_SERVICE_TOKEN: "s".repeat(32),
  RELAY_INSTANCE_ID: "relay-test-1",
  RELAY_TLS_CERT_FILE: "/run/secrets/relay.crt",
  RELAY_TLS_KEY_FILE: "/run/secrets/relay.key",
  RELAY_TLS_CA_FILE: "/run/secrets/gateway-ca.crt",
} as const;

describe("loadRelayConfig", () => {
  it("loads a bounded v1-only relay configuration", () => {
    expect(loadRelayConfig(BASE_ENV)).toEqual({
      protocolVersion: "v1",
      instanceId: "relay-test-1",
      api: {
        baseUrl: "http://127.0.0.1:3000",
        serviceToken: "s".repeat(32),
        timeoutMs: 1_000,
        retryAttempts: 2,
        retryBaseDelayMs: 50,
      },
      gateway: {
        host: "0.0.0.0",
        port: 8443,
        maxFrameBytes: 131_072,
        maxSessions: 10_000,
        maxInflightFrames: 1_024,
        maxInflightFramesPerSession: 4,
        maxFramesPerSecond: 60,
        maxBufferedBytes: 67_108_864,
        maxBufferedBytesPerSession: 1_048_576,
        helloTimeoutMs: 10_000,
        heartbeatSweepMs: 1_000,
        revalidationIntervalMs: 2_000,
        revalidationTimeoutMs: 1_000,
        revalidationFailClosedMs: 5_000,
        shutdownDrainMs: 10_000,
        tls: {
          certificateFile: "/run/secrets/relay.crt",
          privateKeyFile: "/run/secrets/relay.key",
          clientCaFile: "/run/secrets/gateway-ca.crt",
        },
      },
      observability: { host: "127.0.0.1", port: 9091 },
      internal: { host: "127.0.0.1", port: 9092 },
    });
  });

  it("rejects legacy credentials and any protocol other than v1", () => {
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_INTERNAL_TOKEN: "legacy" })).toThrow("RELAY_INTERNAL_TOKEN is obsolete");
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_PROTOCOL_VERSION: "v2" })).toThrow("must be exactly v1");
  });

  it("requires a strong relay-specific credential and bounded values", () => {
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_SERVICE_TOKEN: "short" })).toThrow("between 32 and 512");
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_API_RETRY_ATTEMPTS: "10" })).toThrow("between 0 and 5");
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_API_TIMEOUT_MS: "forever" })).toThrow("between 50 and 10000");
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_REVALIDATION_INTERVAL_MS: "2001" })).toThrow("between 100 and 2000");
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_REVALIDATION_TIMEOUT_MS: "1001" })).toThrow("between 50 and 1000");
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_REVALIDATION_FAIL_CLOSED_MS: "5001" })).toThrow("between 1000 and 5000");
    expect(() => loadRelayConfig({ ...BASE_ENV, RELAY_MAX_FRAME_BYTES: "131073" })).toThrow("between 1024 and 131072");
  });

  it("requires HTTPS for production control-plane calls", () => {
    expect(() => loadRelayConfig({ ...BASE_ENV, NODE_ENV: "production" })).toThrow("must use HTTPS in production");
    expect(loadRelayConfig({ ...BASE_ENV, NODE_ENV: "production", RELAY_API_BASE_URL: "https://api.internal" }).api.baseUrl).toBe("https://api.internal");
  });

  it("keeps gateway and observability listeners separate", () => {
    expect(() =>
      loadRelayConfig({
        ...BASE_ENV,
        RELAY_GATEWAY_HOST: "127.0.0.1",
        RELAY_GATEWAY_PORT: "9091",
        RELAY_OBSERVABILITY_HOST: "127.0.0.1",
        RELAY_OBSERVABILITY_PORT: "9091",
      }),
    ).toThrow("must use different addresses");
  });

  it("keeps the internal control listener separate from the other listeners", () => {
    expect(() =>
      loadRelayConfig({ ...BASE_ENV, RELAY_INTERNAL_LISTEN_HOST: "127.0.0.1", RELAY_INTERNAL_LISTEN_PORT: "9091" }),
    ).toThrow("Observability and internal control listeners must use different addresses");
  });
});
