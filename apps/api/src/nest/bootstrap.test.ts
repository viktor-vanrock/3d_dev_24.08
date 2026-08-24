import { Body, Controller, Get, Inject, Module, NotFoundException, Post, Req } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IsUUID } from "class-validator";
import { SignJWT } from "jose";
import { Pool } from "pg";
import { createNestApp, DEFAULT_NEST_HOST, DEFAULT_NEST_PORT, resolveNestPort } from "./bootstrap.ts";
import { resolveAdminBootstrapConfig, validateRuntimeEnvironment } from "./config/runtime-config.ts";
import { DATABASE_POOL } from "./database/database.constants.ts";
import { AppModule } from "./app.module.ts";
import { RequestContext } from "./observability/request-context.ts";
import { createApiValidationPipe } from "./validation/api-validation.pipe.ts";
import { SESSION_USER, type RequestWithSession } from "./auth/session-verifier.ts";
import { ApiSessionProtected } from "./openapi/api-session-protected.ts";
import { API_ERROR_CODES } from "@portal/contracts/http/error-envelope";

class TestBodyDto {
  @IsUUID()
  declare readonly id: string;
}

@Controller("auth/_test")
class TestController {
  constructor(@Inject(RequestContext) private readonly requestContext: RequestContext) {}

  @Get("context")
  context(): { requestId: string | undefined } {
    return { requestId: this.requestContext.requestId };
  }

  @Get("not-found")
  notFound(): never {
    throw new NotFoundException("SQL select * from users where token=secret");
  }

  @Post("validate")
  validate(@Body() body: TestBodyDto): TestBodyDto {
    return body;
  }
}

@Controller("_test-private")
class PrivateTestController {
  @Get()
  @ApiSessionProtected()
  privateRoute(@Req() request: RequestWithSession): { id: string | undefined } {
    return { id: request[SESSION_USER]?.id };
  }
}

@Module({ imports: [AppModule], controllers: [TestController, PrivateTestController] })
class TestAppModule {}

let app: NestExpressApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("Nest dual-runtime bootstrap", () => {
  it("uses the dedicated migration port when PORT is absent", () => {
    expect(resolveNestPort(undefined)).toBe(DEFAULT_NEST_PORT);
    expect(DEFAULT_NEST_HOST).toBe("0.0.0.0");
  });

  it.each(["0", "65536", "not-a-port"])("rejects invalid PORT=%s", (value) => {
    expect(() => resolveNestPort(value)).toThrow("PORT must be an integer between 1 and 65535");
  });

  it("accepts a valid bootstrap admin configuration", () => {
    expect(
      resolveAdminBootstrapConfig({
        ADMIN_USERNAME: "portal.admin",
        ADMIN_PASSWORD: "long-admin-password",
        ADMIN_PASSWORD_UPDATE_ON_STARTUP: "true",
      }),
    ).toEqual({
      username: "portal.admin",
      password: "long-admin-password",
      updatePasswordOnStartup: true,
    });
  });

  it("keeps bootstrap disabled when admin credentials are absent", () => {
    expect(resolveAdminBootstrapConfig({ ADMIN_PASSWORD_UPDATE_ON_STARTUP: "false" })).toBeNull();
  });

  it.each(["Admin", "admin_user", "a", ".admin", "admin."])("rejects invalid ADMIN_USERNAME=%s", (username) => {
    expect(() =>
      resolveAdminBootstrapConfig({
        ADMIN_USERNAME: username,
        ADMIN_PASSWORD: "long-admin-password",
      }),
    ).toThrow("ADMIN_USERNAME");
  });

  it("requires login and password together", () => {
    expect(() => resolveAdminBootstrapConfig({ ADMIN_USERNAME: "portal.admin" })).toThrow("ADMIN_USERNAME and ADMIN_PASSWORD must be configured together");
  });

  it("rejects a short password and an invalid update flag", () => {
    expect(() => resolveAdminBootstrapConfig({ ADMIN_USERNAME: "portal.admin", ADMIN_PASSWORD: "short" })).toThrow("ADMIN_PASSWORD must contain at least 12 characters");
    expect(() => validateRuntimeEnvironment({ ADMIN_PASSWORD_UPDATE_ON_STARTUP: "sometimes" })).toThrow("ADMIN_PASSWORD_UPDATE_ON_STARTUP must be true, false, 1, or 0");
  });

  it("allows an eight-character password only in explicit development mode", () => {
    expect(
      resolveAdminBootstrapConfig({
        NODE_ENV: "development",
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "12345678",
        ADMIN_PASSWORD_UPDATE_ON_STARTUP: "true",
      }),
    ).toMatchObject({ username: "admin", updatePasswordOnStartup: true });
    expect(() =>
      resolveAdminBootstrapConfig({
        NODE_ENV: "production",
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "12345678",
      }),
    ).toThrow("ADMIN_PASSWORD must contain at least 12 characters");
  });

  it("boots an Express-backed Nest application with health and a Nest-owned DB pool", async () => {
    app = await createNestApp(TestAppModule);
    await app.listen(0, "127.0.0.1");

    const server = app.getHttpServer() as { address(): string | { port: number } | null };
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Nest test server did not bind a TCP port");

    const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { origin: "https://dev.3mf.tech" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", service: "api" });
    expect(response.headers.get("x-powered-by")).toBe("Express");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://dev.3mf.tech");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(app.get<Pool>(DATABASE_POOL)).toBeInstanceOf(Pool);
  });

  it("publishes client-generation OpenAPI schemas and the versioned auth error", async () => {
    app = await createNestApp(TestAppModule);
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer() as { address(): string | { port: number } | null };
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Nest test server did not bind a TCP port");

    const response = await fetch(`http://127.0.0.1:${address.port}/openapi.json`);
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, { get?: { responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> } }>;
      components: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
    };
    expect(document.paths["/health"]?.get?.responses?.["200"]).toBeDefined();
    expect(document.paths["/_test-private"]?.get?.responses?.["401"]?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/ApiErrorEnvelopeDto");
    expect(document.components.schemas?.ApiErrorEnvelopeDto).toBeDefined();
    expect(document.components.schemas?.ApiErrorDto).toBeDefined();
    const apiErrorSchema = document.components.schemas?.ApiErrorDto as
      | {
          properties?: { code?: { enum?: readonly string[] } };
        }
      | undefined;
    expect(apiErrorSchema?.properties?.code?.enum).toEqual(API_ERROR_CODES);
    expect(document.components.securitySchemes).toMatchObject({ portal_session: { in: "cookie" }, bearer: { scheme: "bearer" } });
  });

  it("preserves a valid incoming request id and generates one for invalid input", async () => {
    app = await createNestApp(TestAppModule);
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer() as { address(): string | { port: number } | null };
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Nest test server did not bind a TCP port");
    const base = `http://127.0.0.1:${address.port}`;
    const requestId = "11111111-1111-4111-8111-111111111111";

    const preserved = await fetch(`${base}/health`, { headers: { "x-request-id": requestId } });
    expect(preserved.headers.get("x-request-id")).toBe(requestId);

    const context = await fetch(`${base}/auth/_test/context`, { headers: { "x-request-id": requestId } });
    await expect(context.json()).resolves.toEqual({ requestId });

    const generated = await fetch(`${base}/health`, { headers: { "x-request-id": "token=secret" } });
    expect(generated.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(generated.headers.get("x-request-id")).not.toBe("token=secret");
  });

  it("returns a sanitized versioned envelope for application errors", async () => {
    app = await createNestApp(TestAppModule);
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer() as { address(): string | { port: number } | null };
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Nest test server did not bind a TCP port");

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/_test/not-found`);
    const body = (await response.json()) as { error: { code: string; message: string; requestId: string } };
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("http.not_found.v1");
    expect(body.error.message).toBe("Ресурс не найден");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
    expect(JSON.stringify(body)).not.toMatch(/sql|secret|users/i);
  });

  it("returns 422 from the global DTO pipe for invalid values and unknown fields", async () => {
    const pipe = createApiValidationPipe();
    const metadata = { type: "body" as const, metatype: TestBodyDto, data: undefined };

    await expect(pipe.transform({ id: "nope" }, metadata)).rejects.toMatchObject({ status: 422 });
    await expect(pipe.transform({ id: "11111111-1111-4111-8111-111111111111", password: "secret" }, metadata)).rejects.toMatchObject({ status: 422 });
  });

  it("distinguishes malformed JSON from ordinary bad requests", async () => {
    app = await createNestApp(TestAppModule);
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer() as { address(): string | { port: number } | null };
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Nest test server did not bind a TCP port");

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/_test/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "http.malformed_json.v1" } });
  });

  it("returns a versioned 401 for deny and accepts a valid backend session", async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "nest-auth-test-secret";
    try {
      app = await createNestApp(TestAppModule);
      await app.listen(0, "127.0.0.1");
      const server = app.getHttpServer() as { address(): string | { port: number } | null };
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Nest test server did not bind a TCP port");
      const url = `http://127.0.0.1:${address.port}/_test-private`;

      const denied = await fetch(url);
      expect(denied.status).toBe(401);
      const deniedBody = (await denied.json()) as { error: { code: string; requestId: string } };
      expect(deniedBody.error.code).toBe("auth.unauthorized.v1");
      expect(deniedBody.error.requestId).toBe(denied.headers.get("x-request-id"));

      const token = await new SignJWT({ username: "tester" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("11111111-1111-4111-8111-111111111111")
        .setExpirationTime("5m")
        .sign(new TextEncoder().encode(process.env.JWT_SECRET));
      const allowed = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      expect(allowed.status).toBe(200);
      await expect(allowed.json()).resolves.toEqual({ id: "11111111-1111-4111-8111-111111111111" });

      const cookieWins = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, cookie: "portal_session=invalid-cookie" },
      });
      expect(cookieWins.status).toBe(401);
    } finally {
      if (originalSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalSecret;
    }
  });
});
