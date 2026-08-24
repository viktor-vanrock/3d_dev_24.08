import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
const JWT_SECRET = "nest-billing-domain-test-secret",
  canRun = Boolean(process.env.DATABASE_URL);
let app: NestExpressApplication, baseUrl: string, userId: string;
async function cookie() {
  const token = await new SignJWT({ username: "billing" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}
describe.skipIf(!canRun)("Nest billing domain migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.YOOKASSA_SHOP_ID;
    delete process.env.YOOKASSA_SECRET_KEY;
    userId = (await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-billing-${randomUUID()}`])).rows[0]!.id;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("billing test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (app !== undefined) await app.close();
    await pool.query(`delete from users where id=$1`, [userId]);
    delete process.env.JWT_SECRET;
  });
  it("keeps the eight user/staff routes session-protected", async () => {
    for (const [method, path] of [
      ["POST", "/purchases"],
      ["GET", "/purchases"],
      ["GET", `/purchases/${randomUUID()}`],
      ["GET", "/sales"],
      ["GET", "/me/balance"],
      ["POST", "/payouts"],
      ["GET", "/payouts"],
      ["PATCH", `/payouts/${randomUUID()}`],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "auth.unauthorized.v1" },
      });
    }
  });
  it("keeps webhook open but validates its payload with HTTP 400", async () => {
    const response = await fetch(`${baseUrl}/billing/webhooks/yookassa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "http.bad_request.v1" },
    });
  });
  it("preserves empty account shapes and validation/provider statuses", async () => {
    const headers = {
      cookie: await cookie(),
      "content-type": "application/json",
    };
    for (const [path, body] of [
      ["/purchases", { purchases: [] }],
      ["/sales", { sales: [] }],
      ["/me/balance", { availableMinor: 0, holdMinor: 0, currency: "RUB" }],
      ["/payouts", { payouts: [] }],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, { headers });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(body);
    }
    const missing = await fetch(`${baseUrl}/purchases`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(missing.status).toBe(400);
    const unconfigured = await fetch(`${baseUrl}/purchases`, {
      method: "POST",
      headers,
      body: JSON.stringify({ modelId: randomUUID() }),
    });
    expect(unconfigured.status).toBe(503);
    const badPayout = await fetch(`${baseUrl}/payouts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ amountMinor: 0 }),
    });
    expect(badPayout.status).toBe(400);
    const forbidden = await fetch(`${baseUrl}/payouts/${randomUUID()}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "paid" }),
    });
    expect(forbidden.status).toBe(403);
  });
});
