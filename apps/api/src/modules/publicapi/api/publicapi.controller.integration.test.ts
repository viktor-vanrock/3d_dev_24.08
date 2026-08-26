import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
const JWT_SECRET = "nest-publicapi-test-secret",
  canRun = Boolean(process.env.DATABASE_URL);
let app: NestExpressApplication, baseUrl: string, userId: string;
async function cookie() {
  const token = await new SignJWT({ username: "publicapi-nest", sv: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}
describe.skipIf(!canRun)("Nest publicapi migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    userId = (await pool.query<{ id: string }>(`insert into users(username)values($1)returning id`, [`nest-publicapi-${randomUUID()}`])).rows[0]!.id;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("publicapi test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (userId !== undefined) await pool.query(`delete from users where id=$1`, [userId]);
    delete process.env.JWT_SECRET;
  });
  it("registers all 13 routes behind their intended auth gates", async () => {
    for (const [method, path] of [
      ["POST", "/me/api-keys"],
      ["GET", "/me/api-keys"],
      ["DELETE", `/me/api-keys/${randomUUID()}`],
      ["POST", `/me/api-keys/${randomUUID()}/rotate`],
      ["POST", "/me/user-api-keys"],
      ["GET", "/me/user-api-keys"],
      ["DELETE", `/me/user-api-keys/${randomUUID()}`],
      ["GET", "/v0/printers"],
      ["GET", `/v0/printers/${randomUUID()}`],
      ["GET", `/v0/printers/${randomUUID()}/telemetry`],
      ["POST", `/v0/printers/${randomUUID()}/test-job/commands`],
      ["POST", `/v0/printers/${randomUUID()}/commands`],
      ["GET", `/v0/printers/${randomUUID()}/commands/${randomUUID()}`],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      expect(response.status, `${method} ${path}`).toBe(401);
      const payload = (await response.json()) as { error?: { code?: unknown; requestId?: unknown } };
      expect(payload.error?.code).toBe("auth.unauthorized.v1");
      expect(typeof payload.error?.requestId).toBe("string");
    }
  });
  it("publishes all 13 routes with versioned error envelopes in OpenAPI", async () => {
    const document = (await (await fetch(`${baseUrl}/openapi.json`)).json()) as {
      paths?: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
    };
    for (const [method, path] of [
      ["post", "/me/api-keys"],
      ["get", "/me/api-keys"],
      ["delete", "/me/api-keys/{id}"],
      ["post", "/me/api-keys/{id}/rotate"],
      ["post", "/me/user-api-keys"],
      ["get", "/me/user-api-keys"],
      ["delete", "/me/user-api-keys/{id}"],
      ["get", "/v0/printers"],
      ["get", "/v0/printers/{id}"],
      ["get", "/v0/printers/{id}/telemetry"],
      ["post", "/v0/printers/{id}/test-job/commands"],
      ["post", "/v0/printers/{id}/commands"],
      ["get", "/v0/printers/{id}/commands/{commandId}"],
    ] as const) {
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.responses?.["401"]?.content?.["application/json"]?.schema?.$ref).toContain("ApiErrorEnvelopeDto");
    }
    const testResponses = document.paths?.["/v0/printers/{id}/test-job/commands"]?.post?.responses;
    expect(testResponses).toHaveProperty("200");
    expect(testResponses).toHaveProperty("202");
  });
  it("keeps one-time key plaintext, rate headers, scopes and atomic rotation", async () => {
    const headers = { cookie: await cookie(), "content-type": "application/json" };
    const created = await fetch(`${baseUrl}/me/api-keys`, { method: "POST", headers, body: JSON.stringify({ name: "Nest", scopes: ["read"] }) });
    expect(created.status).toBe(201);
    expect(created.headers.get("x-ratelimit-limit")).not.toBeNull();
    const first = (await created.json()) as { id: string; key: string; key_prefix: string };
    expect(first.key).toMatch(/^mf_pub_/);
    const list = await fetch(`${baseUrl}/me/api-keys`, { headers });
    expect(JSON.stringify(await list.json())).not.toContain(first.key);
    expect((await fetch(`${baseUrl}/v0/printers`, { headers: { authorization: `Bearer ${first.key}` } })).status).toBe(200);
    const denied = await fetch(`${baseUrl}/v0/printers/${randomUUID()}/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${first.key}`, "content-type": "application/json", "idempotency-key": "scope-check" },
      body: JSON.stringify({ command: "stop" }),
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "auth.forbidden.v1" } });
    expect((await fetch(`${baseUrl}/me/api-keys/${first.id}`, { method: "DELETE", headers })).status).toBe(204);
    expect((await fetch(`${baseUrl}/me/api-keys/${first.id}`, { method: "DELETE", headers })).status).toBe(204);
    const replacement = await fetch(`${baseUrl}/me/api-keys`, { method: "POST", headers, body: JSON.stringify({ name: "Replacement", scopes: ["read"] }) });
    expect(replacement.status).toBe(201);
    const replacementResult = (await replacement.json()) as { id: string; key: string };
    const replacementKey = replacementResult.key;
    const replacementId = replacementResult.id;
    const rotated = await fetch(`${baseUrl}/me/api-keys/${replacementId}/rotate`, { method: "POST", headers, body: "{}" });
    expect(rotated.status).toBe(201);
    const second = (await rotated.json()) as { key: string };
    expect((await fetch(`${baseUrl}/v0/printers`, { headers: { authorization: `Bearer ${replacementKey}` } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/v0/printers`, { headers: { authorization: `Bearer ${second.key}` } })).status).toBe(200);
    await pool.query(`update users set status = 'restricted' where id = $1`, [userId]);
    expect((await fetch(`${baseUrl}/v0/printers`, { headers: { authorization: `Bearer ${second.key}` } })).status).toBe(401);
    await pool.query(`update users set status = 'active' where id = $1`, [userId]);
  });
  it("keeps user_api_keys lifecycle under session auth", async () => {
    const headers = { cookie: await cookie(), "content-type": "application/json" };
    const created = await fetch(`${baseUrl}/me/user-api-keys`, { method: "POST", headers, body: "{}" });
    expect(created.status).toBe(201);
    const key = (await created.json()) as { id: string; key: string };
    expect(key.key).toMatch(/^mf_user_/);
    const list = await fetch(`${baseUrl}/me/user-api-keys`, { headers });
    expect(await list.json()).toMatchObject({ keys: [{ id: key.id, scope: "public_api" }] });
    expect((await fetch(`${baseUrl}/me/user-api-keys/${key.id}`, { method: "DELETE", headers })).status).toBe(204);
    expect((await fetch(`${baseUrl}/me/user-api-keys/${key.id}`, { method: "DELETE", headers })).status).toBe(204);
  });
});
