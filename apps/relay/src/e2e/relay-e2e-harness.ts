import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRelayToGatewayFrame,
  type GatewayToRelayFrame,
  type RelayToGatewayFrame,
} from "@portal/contracts/device-protocol/v1";
import { WebSocket } from "ws";
import type { RelayApiClient } from "../api/relay-api-client.service.ts";
import { CommandDeliveryService, type CommandDeliveryOptions } from "../commands/command-delivery.service.ts";
import type { RelayConfig } from "../config/relay-config.ts";
import { GatewayRuntime } from "../gateway/gateway-runtime.service.ts";
import { CorrelationContext } from "../observability/correlation-context.ts";
import type { RelayLogger } from "../observability/relay-logger.ts";
import { RelayMetrics } from "../observability/metrics.service.ts";
import { RuntimeState } from "../observability/runtime-state.service.ts";
import { SessionCommandPortAdapter } from "../session/session-command-port.adapter.ts";
import { SessionRegistry } from "../session/session-registry.ts";
import { SessionTransferPortAdapter } from "../session/session-transfer-port.adapter.ts";
import { FileTransferService, type FileTransferOptions } from "../transfers/file-transfer.service.ts";

export interface TestCertificates {
  readonly directory: string;
  readonly ca: Buffer;
  readonly clientCertificate: Buffer;
  readonly clientKey: Buffer;
  readonly serverCertificateFile: string;
  readonly serverKeyFile: string;
  readonly clientCaFile: string;
}

function runOpenSsl(directory: string, args: readonly string[]): void {
  execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
}

export function createTestCertificates(): TestCertificates {
  const directory = mkdtempSync(join(tmpdir(), "relay-e2e-tls-"));
  runOpenSsl(directory, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-subj", "/CN=Relay E2E CA", "-days", "1"]);
  writeFileSync(join(directory, "server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  runOpenSsl(directory, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"]);
  runOpenSsl(directory, ["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "1", "-extfile", "server.ext"]);
  writeFileSync(join(directory, "client.ext"), "subjectAltName=URI:urn:portal:gateway:gateway-1\nextendedKeyUsage=clientAuth\n");
  runOpenSsl(directory, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "client.key", "-out", "client.csr", "-subj", "/CN=gateway-1"]);
  runOpenSsl(directory, ["x509", "-req", "-in", "client.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAserial", "ca.srl", "-out", "client.crt", "-days", "1", "-extfile", "client.ext"]);
  return {
    directory,
    ca: readFileSync(join(directory, "ca.crt")),
    clientCertificate: readFileSync(join(directory, "client.crt")),
    clientKey: readFileSync(join(directory, "client.key")),
    serverCertificateFile: join(directory, "server.crt"),
    serverKeyFile: join(directory, "server.key"),
    clientCaFile: join(directory, "ca.crt"),
  };
}

export function removeTestCertificates(certificates: TestCertificates): void {
  rmSync(certificates.directory, { recursive: true, force: true });
}

type FrameType = RelayToGatewayFrame["type"];

interface FrameWaiter {
  readonly type: FrameType;
  readonly resolve: (frame: RelayToGatewayFrame) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export class TestGatewayClient {
  private readonly frames: RelayToGatewayFrame[] = [];
  private readonly waiters: FrameWaiter[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const parsed = parseRelayToGatewayFrame(data.toString());
      if (!parsed.ok) {
        this.rejectAll(new Error(`relay emitted a non-canonical frame: ${parsed.error}`));
        return;
      }
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.type === parsed.frame.type);
      if (waiterIndex < 0) {
        this.frames.push(parsed.frame);
        return;
      }
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      if (!waiter) return;
      clearTimeout(waiter.timeout);
      waiter.resolve(parsed.frame);
    });
    socket.on("error", (error) => this.rejectAll(error));
  }

  send(frame: GatewayToRelayFrame): void {
    this.socket.send(JSON.stringify(frame));
  }

  async next<T extends FrameType>(type: T, timeoutMs = 2_000): Promise<Extract<RelayToGatewayFrame, { readonly type: T }>> {
    const queuedIndex = this.frames.findIndex((frame) => frame.type === type);
    if (queuedIndex >= 0) {
      const [frame] = this.frames.splice(queuedIndex, 1);
      return frame as Extract<RelayToGatewayFrame, { readonly type: T }>;
    }
    return await new Promise((resolve, reject) => {
      const resolveFrame = (frame: RelayToGatewayFrame): void => resolve(frame as Extract<RelayToGatewayFrame, { readonly type: T }>);
      const timeout = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolveFrame);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`timed out waiting for ${type}`));
      }, timeoutMs);
      const waiter: FrameWaiter = {
        type,
        resolve: resolveFrame,
        reject,
        timeout,
      };
      this.waiters.push(waiter);
    });
  }

  async expectNoFrame(type: FrameType, timeoutMs = 100): Promise<void> {
    const queued = this.frames.find((frame) => frame.type === type);
    if (queued) throw new Error(`unexpected ${type} frame`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === rejectUnexpected);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve();
      }, timeoutMs);
      const rejectUnexpected = (): void => {
        clearTimeout(timeout);
        reject(new Error(`unexpected ${type} frame`));
      };
      this.waiters.push({ type, resolve: rejectUnexpected, reject, timeout });
    });
  }

  terminate(): void {
    this.socket.terminate();
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  }
}

export interface RelayE2eHarness {
  readonly runtime: GatewayRuntime;
  readonly commandDelivery: CommandDeliveryService;
  readonly fileTransfers: FileTransferService;
  readonly registry: SessionRegistry;
  connect(capabilities?: readonly ("file_transfer" | "cmd.pause" | "cmd.resume" | "cmd.cancel" | "cmd.start")[]): Promise<TestGatewayClient>;
  shutdown(): Promise<void>;
}

interface RelayE2eHarnessOptions {
  readonly certificates: TestCertificates;
  readonly apiV1: object;
  readonly commandOptions?: Partial<CommandDeliveryOptions>;
  readonly fileOptions?: Partial<FileTransferOptions>;
}

export async function createRelayE2eHarness(options: RelayE2eHarnessOptions): Promise<RelayE2eHarness> {
  const config: RelayConfig = {
    protocolVersion: "v1",
    instanceId: "relay-e2e",
    api: { baseUrl: "https://api.invalid", serviceToken: "s".repeat(32), timeoutMs: 100, retryAttempts: 0, retryBaseDelayMs: 1 },
    gateway: {
      host: "127.0.0.1",
      port: 0,
      maxFrameBytes: 131_072,
      maxSessions: 20,
      maxInflightFrames: 100,
      maxInflightFramesPerSession: 10,
      maxFramesPerSecond: 1_000,
      maxBufferedBytes: 4_194_304,
      maxBufferedBytesPerSession: 1_048_576,
      helloTimeoutMs: 1_000,
      heartbeatSweepMs: 1_000,
      revalidationIntervalMs: 2_000,
      revalidationTimeoutMs: 1_000,
      revalidationFailClosedMs: 5_000,
      shutdownDrainMs: 200,
      tls: {
        certificateFile: options.certificates.serverCertificateFile,
        privateKeyFile: options.certificates.serverKeyFile,
        clientCaFile: options.certificates.clientCaFile,
      },
    },
    observability: { host: "127.0.0.1", port: 0 },
  };
  const api = { v1: options.apiV1, revalidationV1: options.apiV1 } as unknown as RelayApiClient;
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as RelayLogger;
  const metrics = new RelayMetrics();
  const registry = new SessionRegistry();
  registry.configure(config.gateway);
  const commandDelivery = new CommandDeliveryService(api, new SessionCommandPortAdapter(registry), config, metrics, logger, {
    claimBatchSize: 10,
    maxConcurrentCommands: 10,
    claimIntervalMs: 60_000,
    leaseHeartbeatMs: 60_000,
    commandTimeoutMs: 2_000,
    completedLedgerSize: 100,
    ...options.commandOptions,
  });
  const fileTransfers = new FileTransferService(api, new SessionTransferPortAdapter(registry), logger, {
    sourceTimeoutMs: 1_000,
    ...options.fileOptions,
  });
  const runtime = new GatewayRuntime(config, api, registry, commandDelivery, fileTransfers, metrics, logger, new CorrelationContext(), new RuntimeState());
  await runtime.start();
  const address = runtime.address();
  if (!address) throw new Error("relay E2E listener did not bind");
  const clients = new Set<TestGatewayClient>();

  return {
    runtime,
    commandDelivery,
    fileTransfers,
    registry,
    async connect(capabilities = ["file_transfer", "cmd.pause"]): Promise<TestGatewayClient> {
      const socket = new WebSocket(`wss://127.0.0.1:${address.port}/relay/ws`, {
        ca: options.certificates.ca,
        cert: options.certificates.clientCertificate,
        key: options.certificates.clientKey,
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
      });
      const client = new TestGatewayClient(socket);
      clients.add(client);
      const challenge = await client.next("hello_challenge");
      client.send({ type: "hello", protocol_version: "v1", nonce: challenge.nonce, agent_version: "relay-e2e-agent", capabilities });
      await client.next("hello_ack");
      return client;
    },
    async shutdown(): Promise<void> {
      await runtime.shutdown();
      for (const client of clients) {
        if (client.socket.readyState !== WebSocket.CLOSED) client.terminate();
      }
    },
  };
}

export async function eventually(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("eventual assertion timed out");
}
