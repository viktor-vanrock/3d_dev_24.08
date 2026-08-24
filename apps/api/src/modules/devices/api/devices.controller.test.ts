import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { RequestMethod } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { MetricsService } from "../../../nest/observability/metrics.service.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import routeManifest from "../../../characterization/routes.manifest.json" with { type: "json" };
import { DevicesController } from "./devices.controller.ts";
import { DEVICES_PORT, type DeviceTransferResponse, type DevicesPort } from "../public/index.ts";
import { PROFILE_AUTH_PORT } from "../../profile/public/index.ts";

const timestamp = "2026-01-01T00:00:00.000Z";
const commandResponse = {
  command_id: "command",
  correlation_id: "correlation",
  device_id: "device",
  command: "pause",
  seq: 1,
  status: "queued",
  result: null,
  error_code: null,
  error_message: null,
  created_at: timestamp,
  acked_at: null,
};
const transferResponse: DeviceTransferResponse = {
  transfer_id: "transfer",
  device_id: "device",
  file_name: "part.gcode",
  size_bytes: 1,
  sha256: null,
  start_print: false,
  kind: "gcode",
  status: "queued",
  next_seq: 0,
  bytes_transferred: 0,
  error_code: null,
  error_message: null,
  updated_at: timestamp,
};
const incidentResponse = {
  id: "incident",
  device_id: "device",
  thread_id: "thread",
  event_type: "offline",
  severity: "warning",
  status: "open",
  occurrence_count: 1,
  first_seen_at: timestamp,
  last_seen_at: timestamp,
  acknowledged_at: null,
  resolved_at: null,
  created_at: timestamp,
  updated_at: timestamp,
};
const printResponse = {
  id: "print",
  device_id: "device",
  slice_job_id: "slice",
  copies: 1,
  status: "awaiting_confirmation",
  gcode_sha256: null,
  transfer_id: "transfer",
  start_command_id: null,
  error_code: null,
  error_message: null,
  created_at: timestamp,
  updated_at: timestamp,
};
const fakeDevices: DevicesPort = {
  createEnrollCode: () => Promise.resolve({ status: 201, body: { id: "code", code: "secret", expires_at: timestamp, install_command: "install", docker_command: "docker" } }),
  revokeEnrollCode: () => Promise.resolve(),
  revokeDevice: () => Promise.resolve({ ok: true }),
  installScript: () => ({ contentType: "text/x-shellscript; charset=utf-8", body: "#!/bin/sh\n" }),
  enrollAgent: () => Promise.resolve({ status: 201, body: { agent_id: "agent", device_id: "device", owner_id: "owner", credential: "credential", expires_at: timestamp } }),
  upsertShare: () =>
    Promise.resolve({
      status: 201,
      body: { share: { id: "share", device_id: "device", user_id: "user", role: "viewer", created_at: new Date(timestamp), updated_at: new Date(timestamp) } },
    }),
  deleteShare: () => Promise.resolve({ ok: true }),
  createCommand: () => Promise.resolve(commandResponse),
  getCommand: () => Promise.resolve(commandResponse),
  createTransfer: () =>
    Promise.resolve({
      status: 202,
      body: {
        ...transferResponse,
        data_plane: { protocol: "relay.file.v1", transfer_id: "transfer", file_name: "part.gcode", size_bytes: 1, sha256: null, start_print: false, next_seq: 0 },
      },
    }),
  getTransfer: () => Promise.resolve(transferResponse),
  listIncidents: () => Promise.resolve({ items: [] }),
  acknowledgeIncident: () => Promise.resolve({ incident: incidentResponse }),
  resolveIncident: () => Promise.resolve({ incident: incidentResponse }),
  transferProfile: () =>
    Promise.resolve({
      status: 202,
      body: { transfer_id: "transfer", status: "initiated", file_name: "part.ini", profile_id: "profile", disclaimer: "best effort" },
    }),
  createPrintRequest: () => Promise.resolve({ status: 200, body: printResponse }),
  getPrintRequest: () => Promise.resolve(printResponse),
  confirmPrintStart: () => Promise.resolve({ status: 202, body: { ...printResponse, status: "accepted" } }),
};

@Global()
@Module({
  providers: [
    SessionVerifier,
    { provide: DEVICES_PORT, useValue: fakeDevices },
    { provide: PROFILE_AUTH_PORT, useValue: { loadOwnerAuthState: () => Promise.resolve(null) } },
    { provide: RuntimeLogger, useValue: { info: vi.fn(), warn: vi.fn() } },
    { provide: MetricsService, useValue: { incRevokedCredentialUse: vi.fn() } },
  ],
  exports: [SessionVerifier, DEVICES_PORT, PROFILE_AUTH_PORT, MetricsService],
})
class DeviceTestPortsModule {}
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DeviceTestPortsModule],
  controllers: [DevicesController],
  providers: [
    RequestContext,
    RuntimeLogger,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class DeviceTestModule {}

function routes(): string[] {
  const prototype = DevicesController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(DevicesController.prototype)
    .flatMap((name) => {
      if (name === "constructor") return [];
      const handler = prototype[name];
      if (typeof handler !== "function") return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) return [];
      const methodName = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"][method] ?? String(method);
      return [`${methodName} /${path}`];
    })
    .sort();
}

describe("Nest devices non-relay route migration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  beforeAll(async () => {
    process.env.JWT_SECRET = "devices-test-secret-devices-test-secret";
    process.env.NODE_ENV = "test";
    app = await createNestApp(DeviceTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });
  it("implements exactly the 19 non-relay device routes", () => {
    const expected = routeManifest
      .filter((route) => route.domain === "devices" && !route.path.startsWith("/internal/relay/"))
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(expected).toHaveLength(19);
    expect(routes()).toEqual(expected);
    expect(routes().some((route) => route.includes("/internal/relay/"))).toBe(false);
  });
  it("keeps the installer and enrollment redemption open", async () => {
    const install = await fetch(`${baseUrl}/devices/agent/install.sh`);
    expect(install.status).toBe(200);
    expect(install.headers.get("content-type")).toContain("text/x-shellscript");
    const enroll = await fetch(`${baseUrl}/devices/agent/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "one-time" }) });
    expect(enroll.status).toBe(201);
  });
  it("keeps session routes protected with the versioned envelope", async () => {
    const response = await fetch(`${baseUrl}/me/devices/enroll-codes`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({ error: { code: "auth.unauthorized.v1" } });
    expect((payload as { error: { requestId: unknown } }).error.requestId).toEqual(expect.any(String));
  });
});
