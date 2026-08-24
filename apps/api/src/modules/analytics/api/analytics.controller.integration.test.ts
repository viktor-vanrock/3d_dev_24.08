import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../public/index.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { RecordConsentDto } from "./analytics.dto.ts";

const JWT_SECRET = "nest-analytics-domain-test-secret";
let app: NestExpressApplication;
let baseUrl: string;

async function bearer(userId: string): Promise<string> {
  const token = await new SignJWT({ username: "analytics-tester", sv: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `Bearer ${token}`;
}

describe("Nest analytics domain migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest analytics test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it("records anonymous consent on the open route and returns the expected cookie", async () => {
    const response = await fetch(`${baseUrl}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "granted", version: "v1" }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
    const anonId = /portal_anon=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    expect(anonId).toMatch(/^[0-9a-f-]{36}$/i);

    try {
      const row = await pool.query<{ action: string; version: string }>(`select action, version from consent_records where anon_id = $1`, [anonId]);
      expect(row.rows).toEqual([{ action: "granted", version: "v1" }]);
    } finally {
      await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
    }
  });

  it("uses the common DTO validation boundary", async () => {
    const pipe = createApiValidationPipe();
    const metadata = { type: "body" as const, metatype: RecordConsentDto, data: undefined };
    await expect(pipe.transform({ action: "maybe", version: "v1" }, metadata)).rejects.toMatchObject({ status: 422 });
    await expect(pipe.transform({ action: "granted", version: " v1 " }, metadata)).resolves.toMatchObject({ version: "v1" });
  });

  it("keeps event emission consent-gated and non-throwing", async () => {
    const analytics = app.get<AnalyticsPort>(ANALYTICS_PORT);
    const anonId = `nest-analytics-${randomUUID()}`;
    try {
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: null });
      expect((await pool.query(`select 1 from events where anon_id = $1`, [anonId])).rowCount).toBe(0);

      await analytics.recordConsent({ anonId, userId: null }, "granted", "v1");
      await analytics.emitEvent({ eventName: "model_view", anonId, userId: null, props: { model_id: "x" } });
      expect((await pool.query(`select 1 from events where anon_id = $1`, [anonId])).rowCount).toBe(1);
    } finally {
      await pool.query(`delete from events where anon_id = $1`, [anonId]);
      await pool.query(`delete from consent_records where anon_id = $1`, [anonId]);
    }
  });

  it("protects analytics health and preserves the response blocks", async () => {
    expect((await fetch(`${baseUrl}/analytics/health`)).status).toBe(401);
    const response = await fetch(`${baseUrl}/analytics/health`, {
      headers: { authorization: await bearer("00000000-0000-0000-0000-000000000001") },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("funnel.signups");
    expect(body).toHaveProperty("activity.stickiness_pct");
    expect(body).toHaveProperty("marketplace.search_to_download_match_rate");
  });
});
