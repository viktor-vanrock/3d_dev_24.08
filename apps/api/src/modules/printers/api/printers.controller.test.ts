import { Global, Module, type RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import manifest from "../../../characterization/routes.manifest.json" with { type: "json" };
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { PRINTER_RESEARCH_AUTH_PORT, PRINTERS_PORT, type PrintersPort } from "../public/index.ts";
import { PrintersController } from "./printers.controller.ts";

let researchUser: UserIdType | null = null;
let researchCall: { readonly userId: UserIdType; readonly anonId: string } | null = null;

const fakePrinters = {
  communityFirmwareList: () => Promise.resolve({ entries: [], limit: 24, offset: 0, has_more: false }),
  connectRecipe: () => ({ version: 1 }),
  researchUpsert: (userId: UserIdType, anonId: string) => {
    researchCall = { userId, anonId };
    return Promise.resolve({ status: 201 as const, body: { printer: { id: "printer-1" }, conflicts: [], draft: false } });
  },
} as unknown as PrintersPort;

@Global()
@Module({
  providers: [
    SessionVerifier,
    { provide: PRINTERS_PORT, useValue: fakePrinters },
    { provide: PRINTER_RESEARCH_AUTH_PORT, useValue: { resolveUser: () => Promise.resolve(researchUser), isResearcher: () => Promise.resolve(researchUser !== null) } },
  ],
  exports: [SessionVerifier, PRINTERS_PORT, PRINTER_RESEARCH_AUTH_PORT],
})
class PrintersTestPortsModule {}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrintersTestPortsModule],
  controllers: [PrintersController],
  providers: [
    RequestContext,
    RuntimeLogger,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class PrintersTestModule {}

function routes(): string[] {
  const prototype = PrintersController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(PrintersController.prototype)
    .flatMap((name) => {
      const handler = prototype[name];
      if (typeof handler !== "function") return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) return [];
      const methodName = ["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"][method] ?? String(method);
      return [`${methodName} /${path.replace("*key", "*")}`];
    })
    .sort();
}

describe("Nest printers route migration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  beforeAll(async () => {
    process.env.JWT_SECRET = "printers-test-secret";
    process.env.NODE_ENV = "test";
    app = await createNestApp(PrintersTestModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it("implements all 18 authoritative printers routes", () => {
    const expected = manifest
      .filter((route) => route.domain === "printers")
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(expected).toHaveLength(18);
    expect(routes()).toEqual(expected);
  });

  it("keeps public firmware reads open", async () => {
    const response = await fetch(`${baseUrl}/community-firmware`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ entries: [], limit: 24, offset: 0, has_more: false });
  });

  it("keeps protected printer routes denied with the versioned envelope", async () => {
    const response = await fetch(`${baseUrl}/printer-connect`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
  });

  it("preserves the research analytics anon cookie side effect", async () => {
    researchUser = UserId("00000000-0000-0000-0000-000000000001");
    researchCall = null;
    const response = await fetch(`${baseUrl}/research/printers`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer research-token" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(201);
    const anonId = /portal_anon=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    expect(anonId).toMatch(/^[0-9a-f-]{36}$/);
    expect(researchCall).toEqual({ userId: researchUser, anonId });
    researchUser = null;
  });
});
