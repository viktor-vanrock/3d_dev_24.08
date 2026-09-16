import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { FEED_AGENT_AUTH_PORT } from "../public/index.ts";
import { PermissionsService } from "../../permissions/application/permissions.service.ts";
import { PermissionGuard } from "../../permissions/guards/permission.guard.ts";
import { FEED_ADMIN_PORT, type FeedAdminPort } from "../public/index.ts";
import { FeedAdminController } from "./feed-admin.controller.ts";

let permissionAllowed = false;
const session = { id: "00000000-0000-0000-0000-000000000001", username: "admin", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };
const admin: FeedAdminPort = {
  list: () => Promise.resolve({ items: [] }), detail: () => Promise.reject(new Error("unused")),
  create: () => Promise.reject(new Error("unused")), update: () => Promise.reject(new Error("unused")),
  publish: () => Promise.reject(new Error("unused")), hide: () => Promise.reject(new Error("unused")),
};

@Global()
@Module({ providers: [
  { provide: SessionVerifier, useValue: { readSession: (request: { headers: { authorization?: string } }) => Promise.resolve(request.headers.authorization === "Bearer valid" ? session : null) } },
  { provide: PermissionsService, useValue: { hasPermission: () => Promise.resolve(permissionAllowed), isActiveUser: () => Promise.resolve(true) } },
  { provide: FEED_AGENT_AUTH_PORT, useValue: { verifyAgentContentToken: () => Promise.resolve(null) } },
  { provide: FEED_ADMIN_PORT, useValue: admin },
], exports: [SessionVerifier, PermissionsService, FEED_AGENT_AUTH_PORT, FEED_ADMIN_PORT] })
class FeedAdminTestPortsModule {}

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), FeedAdminTestPortsModule], controllers: [FeedAdminController], providers: [
  { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: PermissionGuard },
] })
class FeedAdminTestModule {}

describe("Feed admin permissions", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  beforeAll(async () => { app = await createNestApp(FeedAdminTestModule); await app.listen(0, "127.0.0.1"); const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address(); if (address === null || typeof address === "string") throw new Error("test server did not bind"); baseUrl = `http://127.0.0.1:${address.port}`; });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { permissionAllowed = false; });

  it("возвращает 401 без сессии, 403 без grant и 200 с grant", async () => {
    expect((await fetch(`${baseUrl}/data/news`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/data/news`, { headers: { authorization: "Bearer valid" } })).status).toBe(403);
    permissionAllowed = true;
    expect((await fetch(`${baseUrl}/data/news`, { headers: { authorization: "Bearer valid" } })).status).toBe(200);
  });
});
