import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { RequestMethod } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import routeManifest from "../../../characterization/routes.manifest.json" with { type: "json" };
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { GENERATIONS_PORT, type GenerationResponse, type GenerationsPort } from "../public/index.ts";
import { PROFILE_AUTH_PORT } from "../../profile/public/index.ts";
import { GenerationsController } from "./generations.controller.ts";

const asset = { key: "preview.png", contentType: "image/png", cacheControl: "public", object: { body: Readable.from(Buffer.from("png")), contentLength: 3 } };
const generation: GenerationResponse = {
  id: "00000000-0000-4000-8000-000000000001",
  branch: "openscad",
  prompt: "test",
  params: {},
  status: "queued",
  preview_url: null,
  artifact_url: null,
  preview_shots: null,
  source_generation_id: null,
  source_angles: null,
  error: null,
  error_code: null,
  retryable: null,
  progress: null,
  delayed: null,
  queue_position: 1,
  created_at: new Date(),
  updated_at: new Date(),
};
const fakeGenerations: GenerationsPort = {
  health: () => Promise.resolve({ window_hours: 24, branches: [] }),
  createScan: () => ({ id: "scan" }),
  uploadScanPhoto: () => Promise.resolve({ photos: 1 }),
  uploadScanManifest: () => Promise.resolve({ photos: 1 }),
  startScan: () => Promise.resolve({ status: 201, body: { generation } }),
  detail: () => Promise.resolve({ generation }),
  list: () => Promise.resolve({ generations: [] }),
  listConcepts: () => Promise.resolve({ query: null, concepts: [], next_cursor: null, degraded: false }),
  conceptPreview: () => Promise.resolve(asset),
  createConcept: () =>
    Promise.resolve({
      status: 201,
      body: {
        concept: {
          id: "00000000-0000-4000-8000-000000000002",
          generation_id: generation.id,
          normalized_query: "test",
          label: "test",
          prompt: "test",
          motif: null,
          reuse_count: 0,
          status: "queued",
          preview_url: null,
          score: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        generation,
        cached: false,
      },
    }),
  catalogDraft: () =>
    Promise.resolve({ status: 201, body: { model: { id: "00000000-0000-4000-8000-000000000003", title: "test", source_format: "stl", status: "ready", craft: "3d_printing" } } }),
  generationAsset: () => Promise.resolve(asset),
  create: () => Promise.resolve({ status: 201, body: { generation } }),
};

@Global()
@Module({
  providers: [RuntimeLogger, SessionVerifier, { provide: PROFILE_AUTH_PORT, useValue: { loadOwnerAuthState: () => Promise.resolve(null) } }, { provide: GENERATIONS_PORT, useValue: fakeGenerations }],
  exports: [RuntimeLogger, SessionVerifier, PROFILE_AUTH_PORT, GENERATIONS_PORT],
})
class GenerationsTestPortsModule {}
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), GenerationsTestPortsModule],
  controllers: [GenerationsController],
  providers: [
    RequestContext,
    RuntimeLogger,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class GenerationsTestModule {}

function routes(): string[] {
  const prototype = GenerationsController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(GenerationsController.prototype)
    .flatMap((name) => {
      if (name === "constructor") return [];
      const handler = prototype[name];
      if (typeof handler !== "function") return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) return [];
      return [`${["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"][method] ?? String(method)} /${path}`];
    })
    .sort();
}

describe("Nest generations route migration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  beforeAll(async () => {
    process.env.JWT_SECRET = "generations-test-secret-generations";
    process.env.NODE_ENV = "test";
    app = await createNestApp(GenerationsTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it("implements exactly the 15 authoritative generation routes", () => {
    const expected = routeManifest
      .filter((route) => route.domain === "generations")
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(expected).toHaveLength(15);
    expect(routes()).toEqual(expected);
  });
  it("keeps concept reads open even without a session", async () => {
    const response = await fetch(`${baseUrl}/concepts`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ query: null, concepts: [], next_cursor: null, degraded: false });
  });
  it("keeps generation mutations protected with the versioned envelope", async () => {
    const response = await fetch(`${baseUrl}/generations`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
    const payload = await response.text();
    expect(payload).toContain('"code":"auth.unauthorized.v1"');
    expect(payload).toContain('"requestId":');
  });
});
