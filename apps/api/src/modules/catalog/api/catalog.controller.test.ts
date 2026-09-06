import { Global, Module, type RequestMethod } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
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
import { CATALOG_PORT, type CatalogPort } from "../public/index.ts";
import { PROFILE_AUTH_PORT } from "../../profile/public/index.ts";
import { CatalogController } from "./catalog.controller.ts";

const fakeCatalog: CatalogPort = {
  releases: () => Promise.resolve({ releases: [], has_more: false, next_cursor: null }),
  materials: () => Promise.resolve({ materials: [], total: 0, limit: 24, offset: 0, has_more: false }),
  material: () => Promise.reject(new Error("not used")),
  vendors: () => Promise.resolve({ vendors: [] }),
  machines: () => Promise.resolve({ machines: [], has_more: false }),
  machine: () => Promise.reject(new Error("not used")),
  printers: () => Promise.resolve({ contract_version: "printers.catalog.v1", items: [], printers: [], has_more: false, next_cursor: null, gap_counts: {} }),
  printer: () => Promise.reject(new Error("not used")),
  metrics: () => Promise.reject(new Error("not used")),
  materialCandidates: () => Promise.reject(new Error("not used")),
  suggestMaterialCandidate: () => Promise.reject(new Error("not used")),
  approveMaterialCandidate: () => Promise.reject(new Error("not used")),
  rejectMaterialCandidate: () => Promise.reject(new Error("not used")),
  machineCandidates: () => Promise.reject(new Error("not used")),
  suggestMachineCandidate: () => Promise.reject(new Error("not used")),
  approveMachineCandidate: () => Promise.reject(new Error("not used")),
  rejectMachineCandidate: () => Promise.reject(new Error("not used")),
};

@Global()
@Module({
  providers: [RuntimeLogger, SessionVerifier, { provide: PROFILE_AUTH_PORT, useValue: { loadOwnerAuthState: () => Promise.resolve(null) } }, { provide: CATALOG_PORT, useValue: fakeCatalog }],
  exports: [RuntimeLogger, SessionVerifier, PROFILE_AUTH_PORT, CATALOG_PORT],
})
class CatalogTestPortsModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), CatalogTestPortsModule],
  controllers: [CatalogController],
  providers: [
    RequestContext,
    RuntimeLogger,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class CatalogTestModule {}

function controllerRoutes(): readonly string[] {
  const prototype = CatalogController.prototype as unknown as Record<string, unknown>;
  const methodNames = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"];
  return Object.getOwnPropertyNames(CatalogController.prototype)
    .flatMap((name) => {
      if (name === "constructor") return [];
      const handler = prototype[name];
      if (typeof handler !== "function") return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      return path === undefined || method === undefined ? [] : [`${methodNames[method] ?? String(method)} /${path}`];
    })
    .sort();
}

describe("Nest catalog read migration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "catalog-controller-test-secret";
    process.env.NODE_ENV = "test";
    delete process.env.CLOSED_DEV;
    delete process.env.PORTAL_PUBLIC;
    app = await createNestApp(CatalogTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
    delete process.env.CLOSED_DEV;
    delete process.env.PORTAL_PUBLIC;
  });

  it("implements the authoritative catalog read and candidate routes", () => {
    const expected = routeManifest
      .filter((route) => route.domain === "catalog")
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(expected).toHaveLength(17);
    expect(controllerRoutes()).toEqual(expected);
  });

  it("keeps candidate moderation routes session-gated", async () => {
    for (const [method, path] of [
      ["GET", "/material-candidates"],
      ["POST", "/material-candidates"],
      ["GET", "/machine-candidates"],
      ["POST", "/machine-candidates"],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? "{}" : undefined,
      });
      expect(response.status).toBe(401);
      const payload = (await response.json()) as { error?: { code?: unknown } };
      expect(payload.error?.code).toBe("auth.unauthorized.v1");
    }
  });

  it("keeps public reads open and metrics protected with a versioned error", async () => {
    expect((await fetch(`${baseUrl}/materials`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/printers`)).status).toBe(200);
    const metrics = await fetch(`${baseUrl}/catalog/metrics`);
    expect(metrics.status).toBe(401);
    const payload = (await metrics.json()) as { error?: { code?: unknown; requestId?: unknown } };
    expect(payload.error?.code).toBe("auth.unauthorized.v1");
    expect(typeof payload.error?.requestId).toBe("string");
  });

  it("closes normal public reads in CLOSED_DEV but keeps printer catalog always open", async () => {
    process.env.CLOSED_DEV = "1";
    try {
      expect((await fetch(`${baseUrl}/materials`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/printers`)).status).toBe(200);
    } finally {
      delete process.env.CLOSED_DEV;
    }
  });
});
