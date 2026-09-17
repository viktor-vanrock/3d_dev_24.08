import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { FEED_AGENT_AUTH_PORT } from "../../feed/public/index.ts";
import { PermissionsService } from "../../permissions/application/permissions.service.ts";
import { PermissionGuard } from "../../permissions/guards/permission.guard.ts";
import { PRINTERS_PORT } from "../public/index.ts";
import { PrinterAdminController } from "./printer-admin.controller.ts";

let permissionAllowed = false;
const session = { id: "00000000-0000-0000-0000-000000000001", username: "admin", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };
const printers = { researchList: () => Promise.resolve({ items: [] }) };

@Global()
@Module({ providers: [
  { provide: SessionVerifier, useValue: { readSession: (request: { headers: { authorization?: string } }) => Promise.resolve(request.headers.authorization === "Bearer valid" ? session : null) } },
  { provide: PermissionsService, useValue: { hasPermission: () => Promise.resolve(permissionAllowed), isActiveUser: () => Promise.resolve(true) } },
  { provide: FEED_AGENT_AUTH_PORT, useValue: { verifyAgentContentToken: () => Promise.resolve(null) } },
  { provide: PRINTERS_PORT, useValue: printers },
], exports: [SessionVerifier, PermissionsService, FEED_AGENT_AUTH_PORT, PRINTERS_PORT] })
class PrinterAdminTestPortsModule {}

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrinterAdminTestPortsModule], controllers: [PrinterAdminController], providers: [
  ConfigService, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
] })
class PrinterAdminTestModule {}

describe("Printer admin permissions", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  beforeAll(async () => { app = await createNestApp(PrinterAdminTestModule); await app.listen(0, "127.0.0.1"); const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address(); if (address === null || typeof address === "string") throw new Error("test server did not bind"); baseUrl = `http://127.0.0.1:${address.port}`; });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { permissionAllowed = false; });

  it("возвращает 401 без сессии, 403 без grant и 200 с grant", async () => {
    expect((await fetch(`${baseUrl}/data/printers`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/data/printers`, { headers: { authorization: "Bearer valid" } })).status).toBe(403);
    permissionAllowed = true;
    expect((await fetch(`${baseUrl}/data/printers`, { headers: { authorization: "Bearer valid" } })).status).toBe(200);
  });
});
