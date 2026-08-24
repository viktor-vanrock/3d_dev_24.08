import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server as HttpsServer } from "node:https";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import {
  parseGatewayToRelayFrame,
  type Heartbeat,
  type RelayToGatewayFrame,
} from "@portal/contracts/device-protocol/v1";
import type { RelayControlCloseReason } from "@portal/contracts/http/relay-control.v1";
import { WebSocket, WebSocketServer } from "ws";
import { RelayApiClient } from "../api/relay-api-client.service.ts";
import { CommandDeliveryService } from "../commands/command-delivery.service.ts";
import { RELAY_CONFIG, type RelayConfig } from "../config/relay-config.ts";
import { CorrelationContext } from "../observability/correlation-context.ts";
import { RelayLogger } from "../observability/relay-logger.ts";
import { RelayMetrics } from "../observability/metrics.service.ts";
import { RuntimeState } from "../observability/runtime-state.service.ts";
import { SessionRegistry, type GatewaySession } from "../session/session-registry.ts";
import { FileTransferService } from "../transfers/file-transfer.service.ts";
import { gatewayCertificateIdentity, type GatewayCertificateIdentity } from "./gateway-certificate.ts";
import { createRawWebSocketServer } from "./raw-websocket.ts";

const CLOSE_PROTOCOL = 4001;
const CLOSE_HEARTBEAT_TIMEOUT = 4002;
const CLOSE_REPLACED = 4003;
const CLOSE_REVOKED = 4004;
const CLOSE_BACKPRESSURE = 4005;
const API_CAPABILITIES = ["heartbeat.v1", "commands.v1", "files.v1", "command_results.v1", "file_resume.v1"] as const;

type CloseReason = "client_close" | "heartbeat_timeout" | "replaced" | "revoked" | "api_unavailable" | "protocol_error" | "rate_limited" | "backpressure" | "shutdown";
type ErrorFrameCode = Extract<RelayToGatewayFrame, { readonly type: "error" }>["code"];

@Injectable()
export class GatewayRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  private httpsServer: HttpsServer | undefined;
  private websocketServer: WebSocketServer | undefined;
  private heartbeatSweep: NodeJS.Timeout | undefined;
  private revalidationSweep: NodeJS.Timeout | undefined;
  private revalidationRunning = false;
  private draining = false;

  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(RelayApiClient) private readonly api: RelayApiClient,
    @Inject(SessionRegistry) private readonly registry: SessionRegistry,
    @Inject(CommandDeliveryService) private readonly commandDelivery: CommandDeliveryService,
    @Inject(FileTransferService) private readonly fileTransfers: FileTransferService,
    @Inject(RelayMetrics) private readonly metrics: RelayMetrics,
    @Inject(RelayLogger) private readonly logger: RelayLogger,
    @Inject(CorrelationContext) private readonly correlation: CorrelationContext,
    @Inject(RuntimeState) private readonly runtimeState: RuntimeState,
  ) {
    this.registry.configure(config.gateway);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  async start(): Promise<void> {
    if (this.httpsServer) return;
    const [certificate, privateKey, clientCa] = await Promise.all([
      readFile(this.config.gateway.tls.certificateFile),
      readFile(this.config.gateway.tls.privateKeyFile),
      readFile(this.config.gateway.tls.clientCaFile),
    ]);
    const websocketServer = createRawWebSocketServer(this.config.gateway.maxFrameBytes);
    const httpsServer = createServer({
      cert: certificate,
      key: privateKey,
      ca: clientCa,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
    }, (_request, response) => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found\n");
    });

    httpsServer.on("upgrade", (request, socket, head) => {
      if (this.draining || request.url !== "/relay/ws") {
        socket.destroy();
        return;
      }
      const identity = gatewayCertificateIdentity(request.socket as TLSSocket);
      if (!identity) {
        this.metrics.recordAuth("denied");
        socket.destroy();
        return;
      }
      websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket, request, identity));
    });
    websocketServer.on("connection", (socket: WebSocket, request: IncomingMessage, identity: GatewayCertificateIdentity) => {
      void this.acceptConnection(socket, request, identity);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      httpsServer.once("error", onError);
      httpsServer.listen(this.config.gateway.port, this.config.gateway.host, () => {
        httpsServer.off("error", onError);
        resolve();
      });
    });
    this.httpsServer = httpsServer;
    this.websocketServer = websocketServer;
    this.heartbeatSweep = setInterval(() => void this.sweepHeartbeats(), this.config.gateway.heartbeatSweepMs);
    this.heartbeatSweep.unref();
    this.revalidationSweep = setInterval(() => void this.revalidateActiveGateways(), this.config.gateway.revalidationIntervalMs);
    this.revalidationSweep.unref();
    this.logger.info({ event: "relay_gateway_listening", outcome: "ready" }, "relay gateway TLS listener started");
  }

  async closeSessions(agentIds: readonly string[], _reason: RelayControlCloseReason): Promise<{ readonly closed: readonly string[]; readonly notConnected: readonly string[] }> {
    const closed: string[] = [];
    const notConnected: string[] = [];
    for (const agentId of agentIds) {
      const session = this.registry.get(agentId);
      if (session === undefined || session.closing) {
        notConnected.push(agentId);
        continue;
      }
      await this.closeSession(session, CLOSE_REVOKED, "gateway_revoked", "revoked");
      closed.push(agentId);
    }
    return { closed, notConnected };
  }

  async shutdown(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.registry.stopAccepting();
    this.commandDelivery.stopClaiming();
    this.runtimeState.markNotReady("shutting_down");
    if (this.heartbeatSweep) clearInterval(this.heartbeatSweep);
    if (this.revalidationSweep) clearInterval(this.revalidationSweep);
    const deadline = Date.now() + this.config.gateway.shutdownDrainMs;
    const serverClosed = new Promise<void>((resolve) => {
      if (!this.httpsServer) return resolve();
      this.httpsServer.close(() => resolve());
      this.httpsServer.closeAllConnections?.();
    });

    await this.commandDelivery.drain(Math.max(0, deadline - Date.now()));
    while (this.registry.inflightFrames > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const sessions = this.registry.list();
    await this.settleWithin(Promise.allSettled(sessions.map((session) => this.closeSession(session, 1001, "relay_shutdown", "shutdown"))), Math.max(0, deadline - Date.now()));
    for (const session of sessions) {
      if (session.socket.readyState !== WebSocket.CLOSED) session.socket.terminate();
    }
    await this.settleWithin(serverClosed, Math.max(0, deadline - Date.now()));
    const websocketClosed = new Promise<void>((resolve) => {
      if (!this.websocketServer) return resolve();
      this.websocketServer.close(() => resolve());
    });
    await this.settleWithin(websocketClosed, Math.max(0, deadline - Date.now()));
    this.httpsServer = undefined;
    this.websocketServer = undefined;
  }

  address(): AddressInfo | undefined {
    const address = this.httpsServer?.address();
    return address && typeof address !== "string" ? address : undefined;
  }

  async revalidateNow(): Promise<void> {
    await this.revalidateActiveGateways();
  }

  async sweepHeartbeatsNow(): Promise<void> {
    await this.sweepHeartbeats();
  }

  private async acceptConnection(socket: WebSocket, _request: IncomingMessage, identity: GatewayCertificateIdentity): Promise<void> {
    const nonce = randomBytes(32).toString("base64url");
    const challenge: RelayToGatewayFrame = { type: "hello_challenge", nonce };
    socket.send(JSON.stringify(challenge));
    const timeout = setTimeout(() => socket.close(CLOSE_PROTOCOL, "hello_timeout"), this.config.gateway.helloTimeoutMs);
    timeout.unref();

    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      socket.off("message", onMessage);
      clearTimeout(timeout);
      void this.authorizeHello(socket, identity, nonce, data, isBinary);
    };
    socket.on("message", onMessage);
  }

  private async authorizeHello(socket: WebSocket, identity: GatewayCertificateIdentity, nonce: string, data: WebSocket.RawData, isBinary: boolean): Promise<void> {
    if (isBinary) {
      this.metrics.recordAuth("denied");
      this.sendDirect(socket, { type: "error", code: "invalid_frame" });
      socket.close(CLOSE_PROTOCOL, "authentication_failed");
      return;
    }
    const parsed = parseGatewayToRelayFrame(data.toString());
    if (!parsed.ok) {
      this.metrics.recordAuth("denied");
      this.sendDirect(socket, { type: "error", code: parsed.error as ErrorFrameCode });
      socket.close(CLOSE_PROTOCOL, "authentication_failed");
      return;
    }
    if (parsed.frame.type !== "hello" || parsed.frame.nonce !== nonce) {
      this.metrics.recordAuth("denied");
      this.sendDirect(socket, { type: "error", code: "authentication_failed" });
      socket.close(CLOSE_PROTOCOL, "authentication_failed");
      return;
    }
    const hello = parsed.frame;
    if (this.draining || !this.registry.isAccepting) {
      socket.close(1012, "relay_draining");
      return;
    }

    try {
      const correlationId = randomUUID();
      const response = await this.correlation.run(correlationId, () => this.api.v1.relaySessionAuthorize({
        headers: { "x-correlation-id": correlationId, "x-operation-id": randomUUID() },
        body: {
          gateway_identity: identity.gatewayIdentity,
          certificate_fingerprint_sha256: identity.fingerprintSha256,
          protocol_version: "v1",
          agent_version: hello.agent_version,
          capabilities: API_CAPABILITIES,
        },
      }));
      const now = Date.now();
      const session: GatewaySession = {
        gatewayId: response.gateway_id,
        gatewayIdentity: identity.gatewayIdentity,
        certificateFingerprintSha256: identity.fingerprintSha256,
        sessionId: response.session_id,
        sessionGeneration: response.session_generation,
        connectionId: randomUUID(),
        socket,
        authorizationRevision: response.authorization_revision,
        authorizedDevices: new Map(response.authorized_devices.map((device) => [device.device_id, device])),
        lastHeartbeatAt: now,
        lastRevalidatedAt: now,
        heartbeatTimeoutMs: response.heartbeat_timeout_ms,
        inflightFrames: 0,
        rateWindowStartedAt: now,
        rateWindowCount: 0,
        closing: false,
      };
      const replaced = this.registry.install(session);
      if (replaced) await this.closeSession(replaced, CLOSE_REPLACED, "session_replaced", "replaced");
      this.metrics.setActiveSessions(this.registry.size);
      this.metrics.recordAuth("authorized");
      this.sendOrBackpressure(session, {
        type: "hello_ack",
        session_id: session.sessionId,
        gateway_id: session.gatewayId,
        devices: response.authorized_devices.map((device) => ({ device_id: device.device_id })),
        heartbeat_interval_seconds: Math.max(1, Math.ceil(response.heartbeat_interval_ms / 1_000)),
        heartbeat_timeout_seconds: Math.max(1, Math.ceil(response.heartbeat_timeout_ms / 1_000)),
      });
      socket.on("message", (message, binary) => void this.onSessionMessage(session, message, binary));
      socket.once("close", () => void this.onSocketClose(session));
      socket.once("error", () => void this.onSocketClose(session));
      await this.startPendingTransfers(session, response.pending_transfer_ids);
    } catch {
      this.metrics.recordAuth("error");
      this.sendDirect(socket, { type: "error", code: "authorization_failed" });
      socket.close(CLOSE_PROTOCOL, "authorization_failed");
    }
  }

  private async onSessionMessage(session: GatewaySession, data: WebSocket.RawData, isBinary: boolean): Promise<void> {
    const admission = this.registry.beginFrame(session, Date.now());
    if (admission !== "accepted") {
      if (admission === "superseded") return;
      const rateLimited = admission === "rate_limited";
      this.metrics.recordBackpressure(admission === "global_busy" ? "global" : "session", "rejected");
      await this.closeSession(session, rateLimited ? CLOSE_PROTOCOL : CLOSE_BACKPRESSURE, rateLimited ? "rate_limited" : "backpressure_limit", rateLimited ? "rate_limited" : "backpressure");
      return;
    }
    try {
      const parsed = isBinary ? { ok: false as const, error: "invalid_frame" as const } : parseGatewayToRelayFrame(data.toString());
      if (!parsed.ok || parsed.frame.type === "hello") {
        this.metrics.recordProtocol("gateway_to_relay", "rejected", parsed.ok ? "hello" : parsed.error);
        const code: ErrorFrameCode = parsed.ok ? "invalid_frame" : parsed.error as ErrorFrameCode;
        this.sendOrBackpressure(session, { type: "error", code });
        if (!parsed.ok && parsed.error === "unsupported_version") await this.closeSession(session, CLOSE_PROTOCOL, parsed.error, "protocol_error");
        return;
      }
      const deviceId = "device_id" in parsed.frame ? parsed.frame.device_id : undefined;
      if (deviceId && !this.registry.authorizes(session, deviceId)) {
        this.metrics.recordProtocol("gateway_to_relay", "rejected", parsed.frame.type);
        this.logger.warn({ event: "relay_cross_gateway_device_denied", gateway_id: session.gatewayId, device_id: deviceId, outcome: "denied" }, "gateway frame referenced an unauthorized device");
        this.sendOrBackpressure(session, { type: "error", code: "device_not_authorized" });
        return;
      }
      this.metrics.recordProtocol("gateway_to_relay", "accepted", parsed.frame.type);
      if (parsed.frame.type === "heartbeat") await this.handleHeartbeat(session, parsed.frame);
      if (parsed.frame.type === "command_ack") await this.commandDelivery.handleAcknowledged(session, parsed.frame);
      if (parsed.frame.type === "command_result") await this.commandDelivery.handleResult(session, parsed.frame);
      if (parsed.frame.type === "file_start_ack") await this.fileTransfers.handleStartAcknowledged(session, parsed.frame);
      if (parsed.frame.type === "file_chunk_ack") await this.fileTransfers.handleChunkAcknowledged(session, parsed.frame);
      if (parsed.frame.type === "file_result") await this.fileTransfers.handleResult(session, parsed.frame);
    } catch {
      await this.closeSession(session, CLOSE_PROTOCOL, "internal_error", "protocol_error");
    } finally {
      this.registry.endFrame(session);
    }
  }

  private async handleHeartbeat(session: GatewaySession, frame: Heartbeat): Promise<void> {
    for (const device of frame.devices) {
      if (!this.registry.authorizes(session, device.device_id)) {
        this.metrics.recordHeartbeat("invalid");
        this.logger.warn({ event: "relay_cross_gateway_device_denied", gateway_id: session.gatewayId, device_id: device.device_id, outcome: "denied" }, "heartbeat referenced an unauthorized device");
        this.sendOrBackpressure(session, { type: "error", code: "device_not_authorized" });
        return;
      }
    }
    if (!this.registry.heartbeat(session, Date.now())) return;
    const correlationId = randomUUID();
    const response = await this.correlation.run(correlationId, () => this.api.v1.relaySessionHeartbeat({
      headers: { "x-correlation-id": correlationId, "x-operation-id": randomUUID() },
      path: { sessionId: session.sessionId },
      body: {
        gateway_id: session.gatewayId,
        session_generation: session.sessionGeneration,
        authorization_revision: session.authorizationRevision,
        observed_at: new Date().toISOString(),
        devices: frame.devices.map((device) => ({
          device_id: device.device_id,
          sequence: device.sequence,
          state: device.status === "ready" ? "idle" : device.status,
          progress_percent: device.progress_percent ?? 0,
        })),
      },
    }));
    if (!this.registry.current(session)) return;
    this.metrics.recordHeartbeat("accepted");
    this.sendOrBackpressure(session, { type: "heartbeat_ack", message_id: frame.message_id, accepted_device_ids: response.accepted_device_ids });
    await this.startPendingTransfers(session, response.pending_transfer_ids);
  }

  private async startPendingTransfers(session: GatewaySession, transferIds: readonly string[]): Promise<void> {
    if (!this.registry.current(session)) return;
    await Promise.allSettled(transferIds.map((transferId) => this.fileTransfers.startTransfer(session, transferId)));
  }

  private async sweepHeartbeats(): Promise<void> {
    const now = Date.now();
    const closing: Array<Promise<void>> = [];
    for (const session of this.registry.list()) {
      if (now - session.lastHeartbeatAt <= session.heartbeatTimeoutMs) continue;
      this.metrics.recordHeartbeat("timeout");
      closing.push(this.closeSession(session, CLOSE_HEARTBEAT_TIMEOUT, "heartbeat_timeout", "heartbeat_timeout"));
    }
    await Promise.allSettled(closing);
  }

  private async revalidateActiveGateways(): Promise<void> {
    if (this.revalidationRunning || this.draining) return;
    const sessions = this.registry.list();
    if (sessions.length === 0) return;
    this.revalidationRunning = true;
    const startedAt = Date.now();
    try {
      const correlationId = randomUUID();
      const response = await this.withTimeout(
        this.correlation.run(correlationId, () => this.api.revalidationV1.relayGatewaysRevalidate({
          headers: { "x-correlation-id": correlationId },
          body: { gateways: sessions.map((session) => ({
            gateway_id: session.gatewayId,
            session_id: session.sessionId,
            session_generation: session.sessionGeneration,
            known_authorization_revision: session.authorizationRevision,
          })) },
        })),
        this.config.gateway.revalidationTimeoutMs,
      );
      const validatedAt = Date.now();
      const byIdentity = new Map(response.results.map((result) => [`${result.gateway_id}\u0000${result.session_id}\u0000${result.session_generation}`, result]));
      for (const session of sessions) {
        if (!this.registry.current(session)) continue;
        const result = byIdentity.get(`${session.gatewayId}\u0000${session.sessionId}\u0000${session.sessionGeneration}`);
        if (!result || result.state !== "authorized") {
          await this.closeSession(session, CLOSE_REVOKED, "gateway_revoked", result?.state === "superseded" ? "replaced" : "revoked");
          continue;
        }
        this.registry.revalidated(session, result.authorization_revision, result.authorized_devices, validatedAt);
      }
    } catch {
      const now = Date.now();
      for (const session of sessions) {
        if (this.registry.current(session) && now - session.lastRevalidatedAt >= this.config.gateway.revalidationFailClosedMs) {
          await this.closeSession(session, CLOSE_REVOKED, "api_unavailable", "api_unavailable");
        }
      }
    } finally {
      this.revalidationRunning = false;
      const elapsed = Date.now() - startedAt;
      if (elapsed > this.config.gateway.revalidationIntervalMs) {
        this.logger.warn({ event: "relay_revalidation_slow", outcome: "bounded", latency_ms: elapsed }, "gateway revalidation exceeded poll interval");
      }
    }
  }

  private async closeSession(session: GatewaySession, code: number, wireReason: string, apiReason: CloseReason): Promise<void> {
    if (session.closing) return;
    session.closing = true;
    this.commandDelivery.handleDisconnect(session);
    this.fileTransfers.handleDisconnect(session);
    this.registry.remove(session);
    this.metrics.setActiveSessions(this.registry.size);
    if (session.socket.readyState === WebSocket.OPEN) session.socket.close(code, wireReason.slice(0, 123));
    const correlationId = randomUUID();
    try {
      await this.correlation.run(correlationId, () => this.api.v1.relaySessionClose({
        headers: { "x-correlation-id": correlationId, "x-operation-id": randomUUID() },
        path: { sessionId: session.sessionId },
        body: {
          gateway_id: session.gatewayId,
          session_generation: session.sessionGeneration,
          reason: apiReason,
          closed_at: new Date().toISOString(),
        },
      }));
    } catch {
      this.logger.warn({ event: "relay_session_close_report_failed", gateway_id: session.gatewayId, outcome: "error", reason: apiReason }, "relay session close report failed safely");
    }
  }

  private async onSocketClose(session: GatewaySession): Promise<void> {
    if (!this.registry.current(session)) return;
    await this.closeSession(session, 1000, "client_close", "client_close");
  }

  private sendOrBackpressure(session: GatewaySession, frame: RelayToGatewayFrame): boolean {
    if (this.registry.send(session, JSON.stringify(frame))) return true;
    this.metrics.recordBackpressure("session", "rejected");
    void this.closeSession(session, CLOSE_BACKPRESSURE, "backpressure_limit", "backpressure");
    return false;
  }

  private sendDirect(socket: WebSocket, frame: RelayToGatewayFrame): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("relay revalidation timed out")), timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        promise,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
