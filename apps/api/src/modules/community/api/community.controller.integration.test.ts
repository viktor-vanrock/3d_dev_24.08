import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { PROFILE_AUTH_PORT } from "../../profile/public/index.ts";
import { COMMUNITY_STORAGE_PORT, type CommunityPort } from "../application/community.ports.ts";
import { COMMUNITY_PORT } from "../public/index.ts";
import { CommunityController } from "./community.controller.ts";

const community = {
  list: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
  detail: vi.fn().mockResolvedValue({ id: "community", viewer_role: null, related_communities: [] }),
  feed: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
  threads: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
  thread: vi.fn().mockResolvedValue({ thread: {}, posts: [] }),
  attachment: vi.fn().mockResolvedValue({ kind: "photo", key: "public/photo.png" }),
} as unknown as CommunityPort;

@Global()
@Module({
  providers: [
    RuntimeLogger,
    SessionVerifier,
    { provide: PROFILE_AUTH_PORT, useValue: { loadOwnerAuthState: () => Promise.resolve(null) } },
    { provide: COMMUNITY_PORT, useValue: community },
    { provide: COMMUNITY_STORAGE_PORT, useValue: { publicUrl: () => "https://example.test/photo.png" } },
  ],
  exports: [RuntimeLogger, SessionVerifier, PROFILE_AUTH_PORT, COMMUNITY_PORT, COMMUNITY_STORAGE_PORT],
})
class CommunityTestPortsModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), CommunityTestPortsModule],
  controllers: [CommunityController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
class CommunityTestModule {}

describe("Community public reads", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "community-public-read-test-secret";
    process.env.NODE_ENV = "test";
    process.env.CLOSED_DEV = "1";
    app = await createNestApp(CommunityTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
    delete process.env.CLOSED_DEV;
  });

  it("allows a guest to list and open communities", async () => {
    expect((await fetch(`${baseUrl}/communities`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/communities/example`)).status).toBe(200);
  });

  it("allows all declaratively public community reads in CLOSED_DEV", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect((await fetch(`${baseUrl}/communities/${id}/feed`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/communities/${id}/threads`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/threads/${id}`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/posts/${id}/attachments/${id}`, { redirect: "manual" })).status).toBe(302);
  });

  it("keeps community mutations protected", async () => {
    expect((await fetch(`${baseUrl}/communities`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/communities/11111111-1111-4111-8111-111111111111/join`, { method: "POST" })).status).toBe(401);
  });
});
