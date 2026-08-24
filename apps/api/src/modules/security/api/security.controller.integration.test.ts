import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { _resetRateLimitStateForTests, checkRateLimit } from "../application/rate-limit.ts";

const JWT_SECRET = "nest-security-honeypot-test-secret";
const USER_ID = "00000000-0000-4000-8000-0000000000f1";

async function sessionCookie(): Promise<string> {
  const token = await new SignJWT({ username: "honeypot-test" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(USER_ID)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

describe("Nest security honeypot integration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.NODE_ENV = "test";
    _resetRateLimitStateForTests();
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("security test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    _resetRateLimitStateForTests();
    delete process.env.JWT_SECRET;
  });

  it("keeps the route protected and returns the versioned 404 after flagging the identity", async () => {
    const unauthorized = await fetch(`${baseUrl}/internal/project-index/scan`);
    expect(unauthorized.status).toBe(401);

    const response = await fetch(`${baseUrl}/internal/project-index/scan`, {
      headers: {
        cookie: await sessionCookie(),
        "user-agent": "crawler-test/1.0",
        "x-forwarded-for": "203.0.113.55",
      },
    });
    expect(response.status).toBe(404);
    const payload = (await response.json()) as { error?: { code?: unknown; requestId?: unknown } };
    expect(payload.error?.code).toBe("http.not_found.v1");
    expect(typeof payload.error?.requestId).toBe("string");

    expect(checkRateLimit({ ip: "203.0.113.55", headers: { "user-agent": "crawler-test/1.0" } }, "listing", USER_ID)).toMatchObject({ limited: true, retryAfterSeconds: 60 });
  });
});
