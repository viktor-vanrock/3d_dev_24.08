import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { RequestMethod } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { FeedController } from "./feed.controller.ts";
import { FEED_AGENT_AUTH_PORT, FEED_INGEST_AUTH_PORT, FEED_PORT, type FeedPort, type FeedPostResponse } from "../public/index.ts";
import { CommentId, FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import routeManifest from "../../../characterization/routes.manifest.json" with { type: "json" };

const JWT_SECRET = "nest-feed-domain-test-secret";
const post = (id: string): FeedPostResponse => ({
  id: FeedPostId("11111111-1111-4111-8111-111111111111"),
  author_id: UserId("11111111-1111-4111-8111-111111111111"),
  co_author_agent_id: null,
  community_id: null,
  type: "text",
  title: id,
  body: null,
  model_id: null,
  media_s3_key: null,
  make_id: null,
  poster_s3_key: null,
  gitverse_url: null,
  gitverse_meta: null,
  votes_up: 0,
  votes_down: 0,
  comments_count: 0,
  status: "visible",
  created_at: new Date(0),
  is_edited: false,
  edited_at: null,
  source_url: null,
  source_fingerprint: null,
  ingest_provider: null,
  ingest_model: null,
  ingest_prompt_version: null,
  author: null,
});

const fakeFeed: FeedPort = {
  list: (_query, actor) => Promise.resolve({ items: [], next_cursor: null, scope: "all", recommendation_fallback: actor === null }),
  create: () => Promise.resolve({ post: post("created") }),
  ingest: () => Promise.resolve({ status: 201, body: { post: post("ingested"), result: "draft_created" } }),
  detail: () => Promise.resolve({ post: post("detail") }),
  asset: () => Promise.reject(new Error("not used")),
  patch: () => Promise.resolve({ post: post("patched") }),
  delete: () => Promise.resolve({ ok: true }),
  comments: () => Promise.resolve({ comments: [], next_cursor: null }),
  createComment: () =>
    Promise.resolve({
      comment: {
        id: CommentId("11111111-1111-4111-8111-111111111111"),
        user_id: UserId("11111111-1111-4111-8111-111111111111"),
        parent_id: null,
        body: "comment",
        votes_up: 0,
        votes_down: 0,
        created_at: new Date(0),
        author: null,
      },
    }),
  deleteComment: () => Promise.resolve({ ok: true }),
  votePost: () => Promise.resolve({ votes_up: 1, votes_down: 0, votes_up_weighted: 1, votes_down_weighted: 0, my_vote: 1 }),
  voteComment: () => Promise.resolve({ votes_up: 1, votes_down: 0, votes_up_weighted: 1, votes_down_weighted: 0, my_vote: 1 }),
  save: () => Promise.resolve({ saved: true }),
  unsave: () => Promise.resolve({ saved: false }),
  event: () => Promise.resolve({ ok: true }),
  parseGitverse: () => Promise.resolve(null),
  uploadMedia: () => Promise.resolve({ s3_key: "key", url: null, kind: "image" }),
  uploadImage: () => Promise.resolve({ url: "/feed/posts/p/images/i" }),
  image: () => Promise.reject(new Error("not used")),
};

@Global()
@Module({
  providers: [
    SessionVerifier,
    { provide: FEED_PORT, useValue: fakeFeed },
    {
      provide: FEED_AGENT_AUTH_PORT,
      useValue: {
        verifyAgentContentToken: (token: string) =>
          Promise.resolve(token === "agent" ? { userId: UserId("11111111-1111-4111-8111-111111111111"), coAuthorAgentId: "agent-id" } : null),
      },
    },
    {
      provide: FEED_INGEST_AUTH_PORT,
      useValue: {
        verifyIngestToken: (token: string) => Promise.resolve(token === "ingest" ? { userId: UserId("11111111-1111-4111-8111-111111111111"), scope: "feed_ingest" } : null),
      },
    },
  ],
  exports: [SessionVerifier, FEED_PORT, FEED_AGENT_AUTH_PORT, FEED_INGEST_AUTH_PORT],
})
class FeedTestPortsModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), FeedTestPortsModule],
  controllers: [FeedController],
  providers: [
    RequestContext,
    RuntimeLogger,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class FeedTestModule {}

function routeInventory(): string[] {
  const controllerPath = Reflect.getMetadata(PATH_METADATA, FeedController) as string;
  const prototype = FeedController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(FeedController.prototype)
    .flatMap((name) => {
      if (name === "constructor") return [];
      const handler = prototype[name];
      if (typeof handler !== "function") return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) return [];
      const methodName = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"][method] ?? String(method);
      return [`${methodName} /${[controllerPath, path].filter(Boolean).join("/")}`.replace(/\/+$/, "")];
    })
    .sort();
}

async function cookie(): Promise<string> {
  const token = await new SignJWT({ username: "feed-tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("11111111-1111-4111-8111-111111111111")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

describe("Nest feed route migration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.NODE_ENV = "test";
    app = await createNestApp(FeedTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest feed test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it("implements exactly the 20 feed routes in the characterization manifest", () => {
    const characterized = routeManifest
      .filter((route) => route.domain === "feed")
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(characterized).toHaveLength(20);
    expect(routeInventory()).toEqual(characterized);
  });

  it("keeps public feed reads open and returns the characterized success shape", async () => {
    const response = await fetch(`${baseUrl}/feed`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [], next_cursor: null, scope: "all", recommendation_fallback: true });
  });

  it("keeps protected routes denied with the versioned Nest envelope", async () => {
    const response = await fetch(`${baseUrl}/feed/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_name: "feed_scope_change" }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
  });

  it("preserves bearer access for open post creation and 201 success", async () => {
    const response = await fetch(`${baseUrl}/feed/posts`, {
      method: "POST",
      headers: { authorization: "Bearer agent", "content-type": "application/json" },
      body: JSON.stringify({ type: "text", title: "title", body: "body" }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ post: { title: "created", type: "text" } });
  });

  it("preserves authenticated event acceptance at 202", async () => {
    const response = await fetch(`${baseUrl}/feed/events`, {
      method: "POST",
      headers: { cookie: await cookie(), "content-type": "application/json" },
      body: JSON.stringify({ event_name: "feed_scope_change" }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
