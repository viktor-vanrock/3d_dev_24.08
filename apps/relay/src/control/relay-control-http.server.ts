import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import {
  RELAY_CONTROL_CLOSE_REASONS,
  RELAY_CONTROL_CLOSE_SESSIONS_PATH,
  type CloseSessionsRequest,
  type RelayControlCloseReason,
} from "@portal/contracts/http/relay-control.v1";
import { RELAY_CONFIG, type RelayConfig } from "../config/relay-config.ts";
import { GatewayRuntime } from "../gateway/gateway-runtime.service.ts";
import { RelayLogger } from "../observability/relay-logger.ts";
import { RelayMetrics } from "../observability/metrics.service.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16_384;

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function tokensEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(tokenDigest(actual), tokenDigest(expected));
}

function isReason(value: unknown): value is RelayControlCloseReason {
  return typeof value === "string" && (RELAY_CONTROL_CLOSE_REASONS as readonly string[]).includes(value);
}

function isRequest(value: unknown): value is CloseSessionsRequest {
  if (value === null || typeof value !== "object") return false;
  const request = value as { agentIds?: unknown; reason?: unknown };
  return Array.isArray(request.agentIds)
    && request.agentIds.length >= 1
    && request.agentIds.length <= 100
    && request.agentIds.every((agentId) => typeof agentId === "string" && UUID.test(agentId))
    && isReason(request.reason);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
}

@Injectable()
export class RelayControlHttpServer implements OnModuleInit, OnApplicationShutdown {
  private server: Server | undefined;

  constructor(
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(GatewayRuntime) private readonly gateway: GatewayRuntime,
    @Inject(RelayLogger) private readonly logger: RelayLogger,
    @Inject(RelayMetrics) private readonly metrics: RelayMetrics,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.server !== undefined) return;
    const server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.config.internal.port, this.config.internal.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    this.logger.info({ event: "relay_control_listening", outcome: "ready" }, "relay internal control listener started");
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== RELAY_CONTROL_CLOSE_SESSIONS_PATH) {
      response.writeHead(404).end();
      return;
    }
    const header = request.headers["x-relay-service-token"];
    const actual = Array.isArray(header) ? "" : header ?? "";
    if (actual.length < 32 || actual.length > 512 || !tokensEqual(actual, this.config.api.serviceToken)) {
      this.logger.warn({ event: "relay.control.close.rejected", outcome: "unauthorized" }, "relay control close request rejected");
      response.writeHead(401).end();
      return;
    }
    try {
      const body = await readJson(request);
      if (!isRequest(body)) {
        this.logger.warn({ event: "relay.control.close.rejected", outcome: "invalid" }, "relay control close request rejected");
        response.writeHead(400).end();
        return;
      }
      this.logger.info({ event: "relay.control.close.received", outcome: "accepted", reason: body.reason, count: body.agentIds.length }, "relay control close request received");
      const result = await this.gateway.closeSessions(body.agentIds, body.reason);
      this.metrics.recordControlClose();
      this.logger.info({ event: "relay.control.close.completed", outcome: "success", reason: body.reason, count: result.closed.length }, "relay control close request completed");
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(result));
    } catch {
      this.logger.warn({ event: "relay.control.close.rejected", outcome: "invalid" }, "relay control close request rejected");
      response.writeHead(400).end();
    }
  }
}
