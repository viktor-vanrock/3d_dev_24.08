import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RelayApiClient } from "../api/relay-api-client.service.ts";
import { AppModule } from "../app.module.ts";
import type { CommandDeliveryService } from "../commands/command-delivery.service.ts";
import type { RelayConfig } from "../config/relay-config.ts";
import { CorrelationContext } from "../observability/correlation-context.ts";
import type { RelayLogger } from "../observability/relay-logger.ts";
import { RelayMetrics } from "../observability/metrics.service.ts";
import { RuntimeState } from "../observability/runtime-state.service.ts";
import { SessionRegistry, type GatewaySession, type SessionSocket } from "../session/session-registry.ts";
import type { FileTransferService } from "../transfers/file-transfer.service.ts";
import { GatewayRuntime } from "./gateway-runtime.service.ts";

interface TestCertificates {
  readonly directory: string;
  readonly ca: Buffer;
  readonly serverCertificateFile: string;
  readonly serverKeyFile: string;
  readonly clientCertificate: Buffer;
  readonly clientKey: Buffer;
}

function runOpenSsl(directory: string, args: readonly string[]): void {
  execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
}

function createCertificates(): TestCertificates {
  const directory = mkdtempSync(join(tmpdir(), "relay-tls-"));
  runOpenSsl(directory, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-subj", "/CN=Relay Test CA", "-days", "1"]);
  writeFileSync(join(directory, "server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  runOpenSsl(directory, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"]);
  runOpenSsl(directory, ["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "1", "-extfile", "server.ext"]);
  writeFileSync(join(directory, "client.ext"), "subjectAltName=URI:urn:portal:gateway:gateway-1\nextendedKeyUsage=clientAuth\n");
  runOpenSsl(directory, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "client.key", "-out", "client.csr", "-subj", "/CN=gateway-1"]);
  runOpenSsl(directory, ["x509", "-req", "-in", "client.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAserial", "ca.srl", "-out", "client.crt", "-days", "1", "-extfile", "client.ext"]);
  return {
    directory,
    ca: readFileSync(join(directory, "ca.crt")),
    serverCertificateFile: join(directory, "server.crt"),
    serverKeyFile: join(directory, "server.key"),
    clientCertificate: readFileSync(join(directory, "client.crt")),
    clientKey: readFileSync(join(directory, "client.key")),
  };
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try { resolve(JSON.parse(data.toString()) as Record<string, unknown>); } catch (error) { reject(error); }
    });
    socket.once("error", reject);
  });
}

function nextClose(socket: WebSocket): Promise<{ readonly code: number; readonly reason: string }> {
  return new Promise((resolve) => socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
}

async function freePort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to reserve a local test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

describe("GatewayRuntime real TLS/session lifecycle", () => {
  let certificates: TestCertificates;

  beforeAll(() => { certificates = createCertificates(); });
  afterAll(() => rmSync(certificates.directory, { recursive: true, force: true }));

  const commandDelivery = {
    stopClaiming: () => undefined,
    drain: async () => true,
    handleDisconnect: () => undefined,
    handleAcknowledged: async () => ({ accepted: true, replayed: false }),
    handleResult: async () => ({ accepted: true, replayed: false }),
  } as unknown as CommandDeliveryService;
  const transferStarts: string[] = [];
  const fileTransfers = {
    startTransfer: async (_session: unknown, transferId: string) => {
      transferStarts.push(transferId);
      return { accepted: true, replayed: false } as const;
    },
    handleDisconnect: () => undefined,
    handleStartAcknowledged: async () => ({ accepted: true, replayed: false }),
    handleChunkAcknowledged: async () => ({ accepted: true, replayed: false }),
    handleResult: async () => ({ accepted: true, replayed: false }),
  } as unknown as FileTransferService;

  it("requires mTLS, binds certificate identity, fences replacement, enforces device scope, revokes and drains", async () => {
    transferStarts.length = 0;
    const closeReasons: string[] = [];
    let generation = 0;
    let revalidationState: "authorized" | "revoked" = "authorized";
    const apiV1 = {
        relaySessionAuthorize: async (input: { readonly body: { readonly gateway_identity: string; readonly certificate_fingerprint_sha256: string } }) => {
          expect(input.body.gateway_identity).toBe("gateway-1");
          expect(input.body.certificate_fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/);
          generation += 1;
          return {
            gateway_id: "gateway-1",
            session_id: `session-${generation}`,
            session_generation: generation,
            authorization_revision: 7,
            authorized_devices: [{ device_id: "device-1", authorization_revision: 7 }],
            pending_transfer_ids: ["transfer-authorize"],
            heartbeat_interval_ms: 1_000,
            heartbeat_timeout_ms: 5_000,
          };
        },
        relaySessionClose: async (input: { readonly body: { readonly reason: string } }) => {
          closeReasons.push(input.body.reason);
          return { session_id: "session", session_generation: 1, closed_at: new Date().toISOString(), replayed: false };
        },
        relaySessionHeartbeat: async () => ({ session_id: "session", session_generation: generation, authorization_revision: 7, accepted_device_ids: ["device-1"], pending_transfer_ids: ["transfer-heartbeat"], persisted_at: new Date().toISOString(), replayed: false }),
        relayGatewaysRevalidate: async (input: { readonly body: { readonly gateways: ReadonlyArray<{ readonly gateway_id: string; readonly session_id: string; readonly session_generation: number }> } }) => ({
          validated_at: new Date().toISOString(),
          results: input.body.gateways.map((gateway) => ({ ...gateway, authorization_revision: 8, authorized_devices: [{ device_id: "device-1" }], state: revalidationState })),
        }),
    };
    const api = { v1: apiV1, revalidationV1: apiV1 } as unknown as RelayApiClient;
    const config: RelayConfig = {
      protocolVersion: "v1",
      instanceId: "relay-integration",
      api: { baseUrl: "https://api.invalid", serviceToken: "s".repeat(32), timeoutMs: 100, retryAttempts: 0, retryBaseDelayMs: 1 },
      gateway: {
        host: "127.0.0.1",
        port: 0,
        maxFrameBytes: 131_072,
        maxSessions: 10,
        maxInflightFrames: 10,
        maxInflightFramesPerSession: 2,
        maxFramesPerSecond: 20,
        maxBufferedBytes: 1_048_576,
        maxBufferedBytesPerSession: 262_144,
        helloTimeoutMs: 1_000,
        heartbeatSweepMs: 100,
        revalidationIntervalMs: 2_000,
        revalidationTimeoutMs: 1_000,
        revalidationFailClosedMs: 5_000,
        shutdownDrainMs: 1_000,
        tls: { certificateFile: certificates.serverCertificateFile, privateKeyFile: certificates.serverKeyFile, clientCaFile: join(certificates.directory, "ca.crt") },
      },
      observability: { host: "127.0.0.1", port: 0 },
      internal: { host: "127.0.0.1", port: 0 },
    };
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as RelayLogger;
    const registry = new SessionRegistry();
    const runtime = new GatewayRuntime(config, api, registry, commandDelivery, fileTransfers, new RelayMetrics(), logger, new CorrelationContext(), new RuntimeState());
    await runtime.start();
    const address = runtime.address();
    expect(address).toBeDefined();
    const url = `wss://127.0.0.1:${address!.port}/relay/ws`;

    const unauthenticated = new WebSocket(url, { ca: certificates.ca, rejectUnauthorized: true });
    const tlsRejected = new Promise<void>((resolve) => unauthenticated.once("error", () => resolve()));
    await tlsRejected;

    const unsupported = new WebSocket(url, { ca: certificates.ca, cert: certificates.clientCertificate, key: certificates.clientKey, rejectUnauthorized: true, minVersion: "TLSv1.3", maxVersion: "TLSv1.3" });
    const unsupportedChallenge = await nextMessage(unsupported);
    const unsupportedClosed = nextClose(unsupported);
    unsupported.send(JSON.stringify({ type: "hello", protocol_version: "v2", nonce: unsupportedChallenge.nonce, agent_version: "future-agent", capabilities: [] }));
    expect(await nextMessage(unsupported)).toMatchObject({ type: "error", code: "unsupported_version" });
    expect((await unsupportedClosed).code).toBe(4001);
    expect(generation).toBe(0);

    const connect = async (): Promise<WebSocket> => {
      const socket = new WebSocket(url, {
        ca: certificates.ca,
        cert: certificates.clientCertificate,
        key: certificates.clientKey,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
      });
      const challenge = await nextMessage(socket);
      expect(challenge.type).toBe("hello_challenge");
      socket.send(JSON.stringify({ type: "hello", protocol_version: "v1", nonce: challenge.nonce, agent_version: "test-agent", capabilities: ["file_transfer"] }));
      expect((await nextMessage(socket)).type).toBe("hello_ack");
      return socket;
    };

    const first = await connect();
    const firstClosed = nextClose(first);
    const second = await connect();
    expect(await firstClosed).toEqual({ code: 4003, reason: "session_replaced" });
    expect(registry.size).toBe(1);

    second.send(JSON.stringify({ type: "heartbeat", message_id: "heartbeat-1", devices: [{ device_id: "foreign-device", status: "idle", sequence: 1 }] }));
    expect(await nextMessage(second)).toMatchObject({ type: "error", code: "device_not_authorized" });
    second.send(JSON.stringify({ type: "heartbeat", message_id: "heartbeat-2", devices: [{ device_id: "device-1", status: "idle", sequence: 2 }] }));
    expect(await nextMessage(second)).toMatchObject({ type: "heartbeat_ack", message_id: "heartbeat-2", accepted_device_ids: ["device-1"] });
    expect(transferStarts).toEqual(expect.arrayContaining(["transfer-authorize", "transfer-heartbeat"]));

    const secondClosed = nextClose(second);
    revalidationState = "revoked";
    await runtime.revalidateNow();
    expect(await secondClosed).toEqual({ code: 4004, reason: "gateway_revoked" });
    expect(registry.size).toBe(0);

    revalidationState = "authorized";
    const third = await connect();
    const thirdClosed = nextClose(third);
    await runtime.shutdown();
    expect(await thirdClosed).toEqual({ code: 1001, reason: "relay_shutdown" });
    expect(closeReasons).toEqual(expect.arrayContaining(["replaced", "revoked", "shutdown"]));
  }, 20_000);

  it("fails closed after a bounded revalidation timeout and expires missed heartbeats", async () => {
    const closeReasons: string[] = [];
    const apiV1 = {
        relayGatewaysRevalidate: async () => await new Promise<never>(() => undefined),
        relaySessionClose: async (input: { readonly body: { readonly reason: string } }) => {
          closeReasons.push(input.body.reason);
          return { session_id: "session", session_generation: 1, closed_at: new Date().toISOString(), replayed: false };
        },
    };
    const api = { v1: apiV1, revalidationV1: apiV1 } as unknown as RelayApiClient;
    const config: RelayConfig = {
      protocolVersion: "v1",
      instanceId: "relay-timeouts",
      api: { baseUrl: "https://api.invalid", serviceToken: "s".repeat(32), timeoutMs: 50, retryAttempts: 0, retryBaseDelayMs: 1 },
      gateway: {
        host: "127.0.0.1", port: 0, maxFrameBytes: 131_072, maxSessions: 10,
        maxInflightFrames: 10, maxInflightFramesPerSession: 2, maxFramesPerSecond: 20,
        maxBufferedBytes: 1_048_576, maxBufferedBytesPerSession: 262_144,
        helloTimeoutMs: 1_000, heartbeatSweepMs: 100, revalidationIntervalMs: 2_000,
        revalidationTimeoutMs: 50, revalidationFailClosedMs: 1_000, shutdownDrainMs: 1_000,
        tls: { certificateFile: "unused", privateKeyFile: "unused", clientCaFile: "unused" },
      },
      observability: { host: "127.0.0.1", port: 0 },
      internal: { host: "127.0.0.1", port: 0 },
    };
    class FakeSocket implements SessionSocket {
      readyState: number = WebSocket.OPEN;
      bufferedAmount = 0;
      readonly closes: Array<{ readonly code?: number; readonly reason?: string }> = [];
      send(): void {}
      close(code?: number, reason?: string): void { this.closes.push({ code, reason }); this.readyState = WebSocket.CLOSED; }
      terminate(): void { this.readyState = WebSocket.CLOSED; }
    }
    const createSession = (gatewayId: string, lastHeartbeatAt: number, lastRevalidatedAt: number): GatewaySession => ({
      gatewayId,
      gatewayIdentity: gatewayId,
      certificateFingerprintSha256: "a".repeat(64),
      sessionId: `session-${gatewayId}`,
      sessionGeneration: 1,
      connectionId: `connection-${gatewayId}`,
      socket: new FakeSocket(),
      authorizationRevision: 1,
      authorizedDevices: new Map([["device-1", { device_id: "device-1" }]]),
      lastHeartbeatAt,
      lastRevalidatedAt,
      heartbeatTimeoutMs: 1_000,
      inflightFrames: 0,
      rateWindowStartedAt: Date.now(),
      rateWindowCount: 0,
      closing: false,
    });
    const registry = new SessionRegistry();
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as RelayLogger;
    const runtime = new GatewayRuntime(config, api, registry, commandDelivery, fileTransfers, new RelayMetrics(), logger, new CorrelationContext(), new RuntimeState());

    const unavailable = createSession("gateway-unavailable", Date.now(), Date.now() - 1_100);
    registry.install(unavailable);
    const startedAt = Date.now();
    await runtime.revalidateNow();
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect((unavailable.socket as FakeSocket).closes).toContainEqual({ code: 4004, reason: "api_unavailable" });

    const heartbeatExpired = createSession("gateway-heartbeat", Date.now() - 1_100, Date.now());
    registry.install(heartbeatExpired);
    await runtime.sweepHeartbeatsNow();
    expect((heartbeatExpired.socket as FakeSocket).closes).toContainEqual({ code: 4002, reason: "heartbeat_timeout" });
    expect(closeReasons).toEqual(["api_unavailable", "heartbeat_timeout"]);
  });

  it("boots and closes the composed Nest module with the session command adapter", async () => {
    const gatewayPort = await freePort();
    const observabilityPort = await freePort();
    const values = {
      NODE_ENV: "test",
      RELAY_API_BASE_URL: "http://127.0.0.1:9",
      RELAY_SERVICE_TOKEN: "s".repeat(32),
      RELAY_INSTANCE_ID: "relay-module-test",
      RELAY_GATEWAY_HOST: "127.0.0.1",
      RELAY_GATEWAY_PORT: String(gatewayPort),
      RELAY_OBSERVABILITY_HOST: "127.0.0.1",
      RELAY_OBSERVABILITY_PORT: String(observabilityPort),
      RELAY_TLS_CERT_FILE: certificates.serverCertificateFile,
      RELAY_TLS_KEY_FILE: certificates.serverKeyFile,
      RELAY_TLS_CA_FILE: join(certificates.directory, "ca.crt"),
    } as const;
    const previous = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(values)) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      const application = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
      await application.close();
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
