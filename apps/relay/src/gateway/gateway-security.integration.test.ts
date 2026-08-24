import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { RelayApiClient } from "../api/relay-api-client.service.ts";
import type { CommandDeliveryService } from "../commands/command-delivery.service.ts";
import type { RelayConfig } from "../config/relay-config.ts";
import { CorrelationContext } from "../observability/correlation-context.ts";
import {
  allowlistedRelayLogRecord,
  createRelayLogger,
  type RelayLogger,
} from "../observability/relay-logger.ts";
import { RelayMetrics } from "../observability/metrics.service.ts";
import { RuntimeState } from "../observability/runtime-state.service.ts";
import { SessionRegistry } from "../session/session-registry.ts";
import type { FileTransferService } from "../transfers/file-transfer.service.ts";
import { GatewayRuntime } from "./gateway-runtime.service.ts";

interface CertificatePair {
  readonly certificate: Buffer;
  readonly privateKey: Buffer;
}

interface SecurityCertificates {
  readonly directory: string;
  readonly ca: Buffer;
  readonly caFile: string;
  readonly serverCertificateFile: string;
  readonly serverKeyFile: string;
  readonly valid: CertificatePair;
  readonly revoked: CertificatePair;
  readonly expired: CertificatePair;
  readonly foreign: CertificatePair;
  readonly fleetShared: CertificatePair;
  readonly multiIdentity: CertificatePair;
}

interface CloseEvent {
  readonly code: number;
  readonly reason: string;
}

const commandDelivery = {
  stopClaiming: () => undefined,
  drain: async () => true,
  handleDisconnect: () => undefined,
  handleAcknowledged: async () => ({ accepted: true, replayed: false }),
  handleResult: async () => ({ accepted: true, replayed: false }),
} as unknown as CommandDeliveryService;

const fileTransfers = {
  startTransfer: async () => ({ accepted: true, replayed: false }),
  handleDisconnect: () => undefined,
  handleStartAcknowledged: async () => ({ accepted: true, replayed: false }),
  handleChunkAcknowledged: async () => ({ accepted: true, replayed: false }),
  handleResult: async () => ({ accepted: true, replayed: false }),
} as unknown as FileTransferService;

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as RelayLogger;

function runOpenSsl(directory: string, args: readonly string[]): void {
  execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
}

function issueCertificate(
  directory: string,
  name: string,
  signer: string,
  subjectAlternativeNames: readonly string[],
): CertificatePair {
  const extensionFile = `${name}.ext`;
  writeFileSync(
    join(directory, extensionFile),
    `subjectAltName=${subjectAlternativeNames.map((value) => `URI:${value}`).join(",")}\nextendedKeyUsage=clientAuth\n`,
  );
  runOpenSsl(directory, [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.csr`,
    "-subj",
    `/CN=${name}`,
  ]);
  runOpenSsl(directory, [
    "x509",
    "-req",
    "-in",
    `${name}.csr`,
    "-CA",
    `${signer}.crt`,
    "-CAkey",
    `${signer}.key`,
    "-CAcreateserial",
    "-out",
    `${name}.crt`,
    "-days",
    "2",
    "-extfile",
    extensionFile,
  ]);
  return {
    certificate: readFileSync(join(directory, `${name}.crt`)),
    privateKey: readFileSync(join(directory, `${name}.key`)),
  };
}

function issueExpiredCertificate(directory: string): CertificatePair {
  runOpenSsl(directory, [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "expired.key",
    "-out",
    "expired.csr",
    "-subj",
    "/CN=gateway-expired",
  ]);
  mkdirSync(join(directory, "issued"));
  writeFileSync(join(directory, "index.txt"), "");
  writeFileSync(join(directory, "serial"), "1000\n");
  writeFileSync(
    join(directory, "ca.conf"),
    [
      "[ ca ]",
      "default_ca = relay_ca",
      "[ relay_ca ]",
      `dir = ${directory}`,
      "database = $dir/index.txt",
      "new_certs_dir = $dir/issued",
      "certificate = $dir/ca.crt",
      "private_key = $dir/ca.key",
      "serial = $dir/serial",
      "default_md = sha256",
      "policy = relay_policy",
      "[ relay_policy ]",
      "commonName = supplied",
      "[ expired_client ]",
      "basicConstraints = CA:false",
      "keyUsage = digitalSignature",
      "extendedKeyUsage = clientAuth",
      "subjectAltName = URI:urn:portal:gateway:gateway-expired",
      "",
    ].join("\n"),
  );
  runOpenSsl(directory, [
    "ca",
    "-batch",
    "-config",
    "ca.conf",
    "-in",
    "expired.csr",
    "-out",
    "expired.crt",
    "-startdate",
    "20200101000000Z",
    "-enddate",
    "20200102000000Z",
    "-extensions",
    "expired_client",
  ]);
  return {
    certificate: readFileSync(join(directory, "expired.crt")),
    privateKey: readFileSync(join(directory, "expired.key")),
  };
}

function createCertificates(): SecurityCertificates {
  const directory = mkdtempSync(join(tmpdir(), "relay-security-"));
  runOpenSsl(directory, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-subj",
    "/CN=Relay Security Test CA",
    "-days",
    "2",
  ]);
  writeFileSync(
    join(directory, "server.ext"),
    "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n",
  );
  runOpenSsl(directory, [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=localhost",
  ]);
  runOpenSsl(directory, [
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    "-days",
    "2",
    "-extfile",
    "server.ext",
  ]);
  runOpenSsl(directory, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "foreign-ca.key",
    "-out",
    "foreign-ca.crt",
    "-subj",
    "/CN=Foreign Test CA",
    "-days",
    "2",
  ]);

  return {
    directory,
    ca: readFileSync(join(directory, "ca.crt")),
    caFile: join(directory, "ca.crt"),
    serverCertificateFile: join(directory, "server.crt"),
    serverKeyFile: join(directory, "server.key"),
    valid: issueCertificate(directory, "valid", "ca", [
      "urn:portal:gateway:gateway-valid",
    ]),
    revoked: issueCertificate(directory, "revoked", "ca", [
      "urn:portal:gateway:gateway-revoked",
    ]),
    expired: issueExpiredCertificate(directory),
    foreign: issueCertificate(directory, "foreign", "foreign-ca", [
      "urn:portal:gateway:gateway-foreign",
    ]),
    fleetShared: issueCertificate(directory, "fleet-shared", "ca", [
      "urn:portal:gateway:fleet-shared",
    ]),
    multiIdentity: issueCertificate(directory, "multi-identity", "ca", [
      "urn:portal:gateway:gateway-a",
      "urn:portal:gateway:gateway-b",
    ]),
  };
}

function createConfig(
  certificates: SecurityCertificates,
  overrides: Partial<RelayConfig["gateway"]> = {},
  apiOverrides: Partial<RelayConfig["api"]> = {},
): RelayConfig {
  return {
    protocolVersion: "v1",
    instanceId: "relay-security-test",
    api: {
      baseUrl: "http://127.0.0.1:9",
      serviceToken: "s".repeat(32),
      timeoutMs: 100,
      retryAttempts: 0,
      retryBaseDelayMs: 1,
      ...apiOverrides,
    },
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
      revalidationTimeoutMs: 100,
      revalidationFailClosedMs: 5_000,
      shutdownDrainMs: 1_000,
      tls: {
        certificateFile: certificates.serverCertificateFile,
        privateKeyFile: certificates.serverKeyFile,
        clientCaFile: certificates.caFile,
      },
      ...overrides,
    },
    observability: { host: "127.0.0.1", port: 0 },
    internal: { host: "127.0.0.1", port: 0 },
  };
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) =>
    socket.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
}

function rejectedConnection(
  url: string,
  certificates: SecurityCertificates,
  pair: CertificatePair,
): Promise<Error> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      ca: certificates.ca,
      cert: pair.certificate,
      key: pair.privateKey,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
    });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("security handshake did not fail within two seconds"));
    }, 2_000);
    socket.once("open", () => {
      clearTimeout(timeout);
      socket.terminate();
      reject(new Error("security handshake unexpectedly opened"));
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      resolve(error);
    });
  });
}

function openSocket(
  url: string,
  certificates: SecurityCertificates,
  pair: CertificatePair,
): WebSocket {
  return new WebSocket(url, {
    ca: certificates.ca,
    cert: pair.certificate,
    key: pair.privateKey,
    rejectUnauthorized: true,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
  });
}

async function authorizeSocket(
  url: string,
  certificates: SecurityCertificates,
  pair: CertificatePair,
): Promise<WebSocket> {
  const socket = openSocket(url, certificates, pair);
  const challenge = await nextMessage(socket);
  expect(challenge.type).toBe("hello_challenge");
  socket.send(
    JSON.stringify({
      type: "hello",
      protocol_version: "v1",
      nonce: challenge.nonce,
      agent_version: "security-test-agent",
      capabilities: [],
    }),
  );
  expect(await nextMessage(socket)).toMatchObject({
    type: "hello_ack",
    gateway_id: "gateway-valid",
  });
  return socket;
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("GatewayRuntime real TLS/security boundary", () => {
  let certificates: SecurityCertificates;

  beforeAll(() => {
    certificates = createCertificates();
  }, 20_000);

  afterAll(() => {
    rmSync(certificates.directory, { recursive: true, force: true });
  });

  it("accepts an individual certificate and rejects expired, foreign, shared, multi-identity, and API-revoked certificates", async () => {
    const authorizedIdentities: string[] = [];
    const apiV1 = {
      relaySessionAuthorize: async (input: {
        readonly body: { readonly gateway_identity: string };
      }) => {
        authorizedIdentities.push(input.body.gateway_identity);
        if (input.body.gateway_identity !== "gateway-valid")
          throw new Error("gateway authorization denied");
        return {
          gateway_id: "gateway-valid",
          session_id: "session-valid",
          session_generation: 1,
          authorization_revision: 1,
          authorized_devices: [{ device_id: "device-valid" }],
          pending_transfer_ids: [],
          heartbeat_interval_ms: 1_000,
          heartbeat_timeout_ms: 5_000,
        };
      },
      relaySessionClose: async () => ({
        session_id: "session-valid",
        session_generation: 1,
        closed_at: new Date().toISOString(),
        replayed: false,
      }),
      relayGatewaysRevalidate: async () => ({
        validated_at: new Date().toISOString(),
        results: [],
      }),
    };
    const api = {
      v1: apiV1,
      revalidationV1: apiV1,
    } as unknown as RelayApiClient;
    const registry = new SessionRegistry();
    const runtime = new GatewayRuntime(
      createConfig(certificates),
      api,
      registry,
      commandDelivery,
      fileTransfers,
      new RelayMetrics(),
      quietLogger,
      new CorrelationContext(),
      new RuntimeState(),
    );
    await runtime.start();
    const url = `wss://127.0.0.1:${runtime.address()!.port}/relay/ws`;

    try {
      const valid = await authorizeSocket(
        url,
        certificates,
        certificates.valid,
      );
      expect(registry.size).toBe(1);

      await expect(
        rejectedConnection(url, certificates, certificates.expired),
      ).resolves.toBeInstanceOf(Error);
      await expect(
        rejectedConnection(url, certificates, certificates.foreign),
      ).resolves.toBeInstanceOf(Error);
      await expect(
        rejectedConnection(url, certificates, certificates.multiIdentity),
      ).resolves.toBeInstanceOf(Error);

      for (const denied of [certificates.revoked, certificates.fleetShared]) {
        const socket = openSocket(url, certificates, denied);
        const challenge = await nextMessage(socket);
        const closed = nextClose(socket);
        socket.send(
          JSON.stringify({
            type: "hello",
            protocol_version: "v1",
            nonce: challenge.nonce,
            agent_version: "denied-agent",
            capabilities: [],
          }),
        );
        expect(await nextMessage(socket)).toMatchObject({
          type: "error",
          code: "authorization_failed",
        });
        expect(await closed).toEqual({
          code: 4001,
          reason: "authorization_failed",
        });
      }

      expect(authorizedIdentities).toEqual([
        "gateway-valid",
        "gateway-revoked",
        "fleet-shared",
      ]);
      expect(registry.size).toBe(1);
      valid.close();
    } finally {
      await runtime.shutdown();
    }
  }, 20_000);

  it("closes an already-authorized gateway promptly when API revalidation reports revoke", async () => {
    let revoked = false;
    const apiV1 = {
      relaySessionAuthorize: async () => ({
        gateway_id: "gateway-valid",
        session_id: "session-revoke",
        session_generation: 1,
        authorization_revision: 1,
        authorized_devices: [{ device_id: "device-valid" }],
        pending_transfer_ids: [],
        heartbeat_interval_ms: 1_000,
        heartbeat_timeout_ms: 5_000,
      }),
      relaySessionClose: async () => ({
        session_id: "session-revoke",
        session_generation: 1,
        closed_at: new Date().toISOString(),
        replayed: false,
      }),
      relayGatewaysRevalidate: async (input: {
        readonly body: {
          readonly gateways: ReadonlyArray<{
            readonly gateway_id: string;
            readonly session_id: string;
            readonly session_generation: number;
          }>;
        };
      }) => ({
        validated_at: new Date().toISOString(),
        results: input.body.gateways.map((gateway) => ({
          ...gateway,
          authorization_revision: revoked ? 2 : 1,
          authorized_devices: revoked ? [] : [{ device_id: "device-valid" }],
          state: revoked ? ("revoked" as const) : ("authorized" as const),
        })),
      }),
    };
    const api = {
      v1: apiV1,
      revalidationV1: apiV1,
    } as unknown as RelayApiClient;
    const registry = new SessionRegistry();
    const runtime = new GatewayRuntime(
      createConfig(certificates),
      api,
      registry,
      commandDelivery,
      fileTransfers,
      new RelayMetrics(),
      quietLogger,
      new CorrelationContext(),
      new RuntimeState(),
    );
    await runtime.start();
    const url = `wss://127.0.0.1:${runtime.address()!.port}/relay/ws`;

    try {
      const socket = await authorizeSocket(
        url,
        certificates,
        certificates.valid,
      );
      const closed = nextClose(socket);
      revoked = true;
      const revokedAt = Date.now();
      await runtime.revalidateNow();
      expect(await closed).toEqual({ code: 4004, reason: "gateway_revoked" });
      expect(Date.now() - revokedAt).toBeLessThan(5_000);
      expect(registry.size).toBe(0);
    } finally {
      await runtime.shutdown();
    }
  }, 10_000);

  it("fails hello closed through the real API client when the relay service credential is invalid", async () => {
    const expectedToken = "expected-service-token".padEnd(32, "x");
    const invalidToken = "invalid-service-token".padEnd(32, "x");
    const observedTokens: string[] = [];
    const apiServer = createHttpServer((request, response) => {
      observedTokens.push(
        String(request.headers["x-relay-service-token"] ?? ""),
      );
      response.writeHead(
        request.headers["x-relay-service-token"] === expectedToken ? 500 : 401,
        { "content-type": "application/json" },
      );
      response.end(
        JSON.stringify({
          code: "relay_service_unauthorized",
          message: "relay service authentication failed",
          correlation_id: "security-test",
        }),
      );
    });
    await new Promise<void>((resolve) =>
      apiServer.listen(0, "127.0.0.1", resolve),
    );
    const apiAddress = apiServer.address();
    if (!apiAddress || typeof apiAddress === "string")
      throw new Error("failed to start test API server");
    const config = createConfig(
      certificates,
      {},
      {
        baseUrl: `http://127.0.0.1:${apiAddress.port}`,
        serviceToken: invalidToken,
      },
    );
    const metrics = new RelayMetrics();
    const correlation = new CorrelationContext();
    const api = new RelayApiClient(config, quietLogger, metrics, correlation);
    const registry = new SessionRegistry();
    const runtime = new GatewayRuntime(
      config,
      api,
      registry,
      commandDelivery,
      fileTransfers,
      metrics,
      quietLogger,
      correlation,
      new RuntimeState(),
    );
    await runtime.start();
    const url = `wss://127.0.0.1:${runtime.address()!.port}/relay/ws`;

    try {
      const socket = openSocket(url, certificates, certificates.valid);
      const challenge = await nextMessage(socket);
      const closed = nextClose(socket);
      socket.send(
        JSON.stringify({
          type: "hello",
          protocol_version: "v1",
          nonce: challenge.nonce,
          agent_version: "invalid-service-token-agent",
          capabilities: [],
        }),
      );
      expect(await nextMessage(socket)).toEqual({
        type: "error",
        code: "authorization_failed",
      });
      expect(await closed).toEqual({
        code: 4001,
        reason: "authorization_failed",
      });
      expect(observedTokens).toEqual([invalidToken]);
      expect(registry.size).toBe(0);
    } finally {
      await runtime.shutdown();
      await closeHttpServer(apiServer);
    }
  }, 10_000);

  it("fails an active TLS session closed during an API outage in less than five seconds", async () => {
    let outage = false;
    const apiV1 = {
      relaySessionAuthorize: async () => ({
        gateway_id: "gateway-valid",
        session_id: "session-outage",
        session_generation: 1,
        authorization_revision: 1,
        authorized_devices: [{ device_id: "device-valid" }],
        pending_transfer_ids: [],
        heartbeat_interval_ms: 1_000,
        heartbeat_timeout_ms: 5_000,
      }),
      relaySessionClose: async () => ({
        session_id: "session-outage",
        session_generation: 1,
        closed_at: new Date().toISOString(),
        replayed: false,
      }),
      relayGatewaysRevalidate: async (input: {
        readonly body: {
          readonly gateways: ReadonlyArray<{
            readonly gateway_id: string;
            readonly session_id: string;
            readonly session_generation: number;
          }>;
        };
      }) => {
        if (outage) return await new Promise<never>(() => undefined);
        return {
          validated_at: new Date().toISOString(),
          results: input.body.gateways.map((gateway) => ({
            ...gateway,
            authorization_revision: 1,
            authorized_devices: [{ device_id: "device-valid" }],
            state: "authorized" as const,
          })),
        };
      },
    };
    const api = {
      v1: apiV1,
      revalidationV1: apiV1,
    } as unknown as RelayApiClient;
    const registry = new SessionRegistry();
    const runtime = new GatewayRuntime(
      createConfig(certificates, {
        revalidationIntervalMs: 100,
        revalidationTimeoutMs: 50,
        revalidationFailClosedMs: 500,
      }),
      api,
      registry,
      commandDelivery,
      fileTransfers,
      new RelayMetrics(),
      quietLogger,
      new CorrelationContext(),
      new RuntimeState(),
    );
    await runtime.start();
    const url = `wss://127.0.0.1:${runtime.address()!.port}/relay/ws`;

    try {
      const socket = await authorizeSocket(
        url,
        certificates,
        certificates.valid,
      );
      const closed = nextClose(socket);
      outage = true;
      const outageStartedAt = Date.now();
      expect(await closed).toEqual({ code: 4004, reason: "api_unavailable" });
      const elapsed = Date.now() - outageStartedAt;
      expect(elapsed).toBeGreaterThanOrEqual(400);
      expect(elapsed).toBeLessThan(5_000);
      expect(registry.size).toBe(0);
    } finally {
      await runtime.shutdown();
    }
  }, 10_000);

  it("redacts tokens, certificates, private keys, payloads, file content, and raw error stacks", () => {
    const secrets = {
      token: "relay-token-must-not-leak",
      certificate: "client-certificate-must-not-leak",
      privateKey: "private-key-must-not-leak",
      commandPayload: "command-payload-must-not-leak",
      fileContent: "file-content-must-not-leak",
      stack: "provider-stack-must-not-leak",
    };
    let output = "";
    const destination = new Writable({
      write: (chunk, _encoding, callback) => {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createRelayLogger("relay-security-test", destination);
    logger.error(
      {
        token: secrets.token,
        headers: {
          authorization: secrets.token,
          "x-relay-service-token": secrets.token,
        },
        certificate: secrets.certificate,
        privateKey: secrets.privateKey,
        commandPayload: secrets.commandPayload,
        fileContent: secrets.fileContent,
        err: { stack: secrets.stack },
      },
      "safe security failure",
    );

    for (const secret of Object.values(secrets))
      expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
    expect(
      allowlistedRelayLogRecord({
        event: "relay_auth",
        gateway_id: "gateway-valid",
        ...secrets,
      } as never),
    ).toEqual({ event: "relay_auth", gateway_id: "gateway-valid" });
  });
});
