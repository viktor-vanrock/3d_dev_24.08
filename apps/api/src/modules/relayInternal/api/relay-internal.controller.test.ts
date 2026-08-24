import { Global, Module, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ConfigModule } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { DEVICE_COMMAND_RELAY_PORT } from "../../devices/public/index.ts";
import { RelayInternalService } from "../application/relay-internal.service.ts";
import { RELAY_CONTROL_PORT, type RelayControlPort } from "../public/index.ts";
import { RelayInternalController } from "./relay-internal.controller.ts";
import { RelayInternalExceptionFilter } from "./relay-internal.filter.ts";
import { RelayServiceGuard } from "./relay-service.guard.ts";

const SERVICE_TOKEN = "relay-service-token-that-is-at-least-thirty-two-characters";
const CORRELATION_ID = "correlation-test-0001";
const OPERATION_ID = "operation-test-0001";

const authorizeResponse = {
  session_id: "session-1",
  session_generation: 1,
  gateway_id: "gateway-1",
  authorization_revision: 2,
  authorized_devices: [{ device_id: "device-1", authorization_revision: 2 }],
  pending_transfer_ids: [],
  heartbeat_interval_ms: 5_000,
  heartbeat_timeout_ms: 15_000,
} as const;

const control: RelayControlPort = {
  authorizeSession: vi.fn(async () => authorizeResponse),
  heartbeatSession: vi.fn(async (input) => ({
    session_id: input.sessionId,
    session_generation: input.request.session_generation,
    authorization_revision: input.request.authorization_revision,
    accepted_device_ids: input.request.devices.map((device: { readonly device_id: string }) => device.device_id),
    pending_transfer_ids: [],
    persisted_at: input.request.observed_at,
    replayed: false,
  })),
  closeSession: vi.fn(async (input) => ({
    session_id: input.sessionId,
    session_generation: input.request.session_generation,
    closed_at: input.request.closed_at,
    replayed: false,
  })),
  revalidateGateways: vi.fn(async (request) => ({
    results: request.gateways.map(
      (gateway: { readonly gateway_id: string; readonly session_id: string; readonly session_generation: number; readonly known_authorization_revision: number }) => ({
        ...gateway,
        state: "authorized" as const,
        authorization_revision: gateway.known_authorization_revision,
        authorized_devices: [],
      }),
    ),
    validated_at: new Date().toISOString(),
  })),
  authorizeCommandSession: vi.fn(async () => ({ gatewayId: "gateway-1", ownerId: "owner-1", authorizationRevision: 2, authorizedDeviceIds: [] })),
  getTransferMetadata: vi.fn(async () => Promise.reject(new Error("not used"))),
  getTransferSourceTuple: vi.fn(async () => Promise.reject(new Error("not used"))),
  writeTransferProgress: vi.fn(async () => Promise.reject(new Error("not used"))),
  writeTransferResult: vi.fn(async () => Promise.reject(new Error("not used"))),
};

const commands = {
  claim: vi.fn(async () => []),
  heartbeat: vi.fn(async () => null),
  writeResult: vi.fn(async () => ({ kind: "conflict" as const })),
};

@Global()
@Module({
  providers: [
    { provide: RELAY_CONTROL_PORT, useValue: control },
    { provide: DEVICE_COMMAND_RELAY_PORT, useValue: commands },
  ],
  exports: [RELAY_CONTROL_PORT, DEVICE_COMMAND_RELAY_PORT],
})
class RelayInternalTestPortsModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), RelayInternalTestPortsModule],
  controllers: [RelayInternalController],
  providers: [RelayInternalService, RelayServiceGuard, RelayInternalExceptionFilter],
})
class RelayInternalTestModule {}

function controllerRoutes(): readonly string[] {
  const prototype = RelayInternalController.prototype as unknown as Record<string, unknown>;
  const controllerPath = Reflect.getMetadata(PATH_METADATA, RelayInternalController) as string;
  const methodNames = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"];
  return Object.getOwnPropertyNames(prototype)
    .flatMap((name) => {
      if (name === "constructor") return [];
      const handler = prototype[name];
      if (typeof handler !== "function") return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      return path === undefined || method === undefined ? [] : [`${methodNames[method] ?? String(method)} /${controllerPath}/${path}`];
    })
    .sort();
}

describe("relay internal v1 controller", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.RELAY_SERVICE_TOKEN = SERVICE_TOKEN;
    app = await createNestApp(RelayInternalTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.RELAY_SERVICE_TOKEN;
  });

  it("implements exactly the canonical eleven v1 operations", () => {
    expect(controllerRoutes()).toEqual(
      [
        "POST /internal/relay/v1/sessions/authorize",
        "POST /internal/relay/v1/sessions/:sessionId/heartbeat",
        "POST /internal/relay/v1/sessions/:sessionId/close",
        "POST /internal/relay/v1/gateways/revalidate",
        "POST /internal/relay/v1/commands/claim",
        "POST /internal/relay/v1/commands/:commandId/lease-heartbeat",
        "PUT /internal/relay/v1/commands/:commandId/result",
        "GET /internal/relay/v1/transfers/:transferId/metadata",
        "POST /internal/relay/v1/transfers/:transferId/source-url",
        "PUT /internal/relay/v1/transfers/:transferId/progress",
        "PUT /internal/relay/v1/transfers/:transferId/result",
      ].sort(),
    );
  });

  it("rejects missing and gateway bearer credentials with the relay-only safe envelope", async () => {
    for (const requestHeaders of [
      new Headers({ "x-correlation-id": CORRELATION_ID }),
      new Headers({ "x-correlation-id": CORRELATION_ID, authorization: "Bearer gateway-token" }),
    ]) {
      requestHeaders.set("x-operation-id", OPERATION_ID);
      requestHeaders.set("content-type", "application/json");
      const response = await fetch(`${baseUrl}/internal/relay/v1/sessions/authorize`, {
        method: "POST",
        headers: requestHeaders,
        body: "{}",
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "relay.auth.invalid_service_credential.v1",
          message: "Invalid relay service credential",
          request_id: CORRELATION_ID,
          retryable: false,
        },
      });
    }
  });

  it("echoes correlation and dispatches an authenticated authorize operation", async () => {
    const response = await fetch(`${baseUrl}/internal/relay/v1/sessions/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-service-token": SERVICE_TOKEN,
        "x-correlation-id": CORRELATION_ID,
        "x-operation-id": OPERATION_ID,
      },
      body: JSON.stringify({
        gateway_identity: "gateway-identity-1",
        certificate_fingerprint_sha256: "a".repeat(64),
        protocol_version: "v1",
        agent_version: "1.0.0",
        capabilities: ["heartbeat.v1"],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
    await expect(response.json()).resolves.toEqual(authorizeResponse);
    expect(control.authorizeSession).toHaveBeenCalledWith(expect.objectContaining({ operationId: OPERATION_ID, connectionId: OPERATION_ID }));
  });

  it("rejects request bodies outside the canonical closed schema", async () => {
    const response = await fetch(`${baseUrl}/internal/relay/v1/sessions/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-service-token": SERVICE_TOKEN,
        "x-correlation-id": CORRELATION_ID,
        "x-operation-id": OPERATION_ID,
      },
      body: JSON.stringify({ gateway_identity: "gateway-identity-1", unexpected_secret: "must-not-pass" }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: { code?: string; request_id?: string } };
    expect(payload.error).toMatchObject({ code: "relay.validation.invalid.v1", request_id: CORRELATION_ID });
    expect(control.authorizeSession).toHaveBeenCalledTimes(1);
  });
});
