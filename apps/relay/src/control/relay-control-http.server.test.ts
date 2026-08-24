import { afterEach, describe, expect, it, vi } from "vitest";
import type { RelayConfig } from "../config/relay-config.ts";
import { RelayControlHttpServer } from "./relay-control-http.server.ts";

const SERVICE_TOKEN = "s".repeat(32);
let server: RelayControlHttpServer | undefined;

function config(): RelayConfig {
  return {
    protocolVersion: "v1",
    instanceId: "relay-control-test",
    api: { baseUrl: "http://127.0.0.1:3000", serviceToken: SERVICE_TOKEN, timeoutMs: 100, retryAttempts: 0, retryBaseDelayMs: 1 },
    gateway: {
      host: "127.0.0.1", port: 8443, maxFrameBytes: 131_072, maxSessions: 10, maxInflightFrames: 10, maxInflightFramesPerSession: 2,
      maxFramesPerSecond: 20, maxBufferedBytes: 1_048_576, maxBufferedBytesPerSession: 262_144, helloTimeoutMs: 1_000,
      heartbeatSweepMs: 100, revalidationIntervalMs: 2_000, revalidationTimeoutMs: 100, revalidationFailClosedMs: 5_000,
      shutdownDrainMs: 1_000, tls: { certificateFile: "unused", privateKeyFile: "unused", clientCaFile: "unused" },
    },
    observability: { host: "127.0.0.1", port: 9091 },
    internal: { host: "127.0.0.1", port: 0 },
  };
}

async function url(): Promise<string> {
  const value = (server as unknown as { server: { address(): { port: number } | null } }).server.address();
  if (value === null) throw new Error("control listener did not bind");
  return `http://127.0.0.1:${value.port}`;
}

afterEach(async () => { await server?.onApplicationShutdown(); server = undefined; });

describe("RelayControlHttpServer", () => {
  it("closes a valid batch and rejects invalid credentials and payloads", async () => {
    const gateway = { closeSessions: vi.fn().mockResolvedValue({ closed: ["11111111-1111-4111-8111-111111111111"], notConnected: [] }) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    server = new RelayControlHttpServer(config(), gateway as never, logger as never, { recordControlClose: vi.fn() } as never);
    await server.onModuleInit();
    const baseUrl = await url();

    const valid = await fetch(`${baseUrl}/internal/relay/v1/sessions/close`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-service-token": SERVICE_TOKEN },
      body: JSON.stringify({ agentIds: ["11111111-1111-4111-8111-111111111111"], reason: "agent_revoked" }),
    });
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toEqual({ closed: ["11111111-1111-4111-8111-111111111111"], notConnected: [] });

    const unauthorized = await fetch(`${baseUrl}/internal/relay/v1/sessions/close`, { method: "POST", body: "{}" });
    expect(unauthorized.status).toBe(401);
    const invalid = await fetch(`${baseUrl}/internal/relay/v1/sessions/close`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-service-token": SERVICE_TOKEN },
      body: JSON.stringify({ agentIds: [], reason: "invalid" }),
    });
    expect(invalid.status).toBe(400);
  });
});
