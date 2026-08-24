import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
const JWT_SECRET = "nest-agents-test-secret",
  USERNAME = `nest-agents-${randomUUID()}`,
  canRun = Boolean(process.env.DATABASE_URL);
let app: NestExpressApplication, baseUrl: string, userId: string;
async function cookie() {
  const token = await new SignJWT({ username: USERNAME })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}
describe.skipIf(!canRun)("Nest agents migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AGENT_ACCOUNTS_BETA_USERNAMES = USERNAME;
    userId = (await pool.query<{ id: string }>(`insert into users(username)values($1)returning id`, [USERNAME])).rows[0]!.id;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("agents test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (userId !== undefined) await pool.query(`delete from users where id=$1`, [userId]);
    delete process.env.JWT_SECRET;
    delete process.env.AGENT_ACCOUNTS_BETA_USERNAMES;
  });
  it("registers all six routes as session protected", async () => {
    for (const [method, path] of [
      ["POST", "/me/agents"],
      ["GET", "/me/agents"],
      ["POST", `/me/agents/${randomUUID()}/revoke`],
      ["POST", `/me/agents/${randomUUID()}/keys`],
      ["GET", `/me/agents/${randomUUID()}/keys`],
      ["POST", `/me/agents/${randomUUID()}/keys/${randomUUID()}/revoke`],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      expect(response.status, `${method} ${path}`).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
    }
  });
  it("publishes all six routes with versioned error envelopes in OpenAPI", async () => {
    const document = (await (await fetch(`${baseUrl}/openapi.json`)).json()) as {
      paths?: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
    };
    for (const [method, path] of [
      ["post", "/me/agents"],
      ["get", "/me/agents"],
      ["post", "/me/agents/{id}/revoke"],
      ["post", "/me/agents/{id}/keys"],
      ["get", "/me/agents/{id}/keys"],
      ["post", "/me/agents/{id}/keys/{keyId}/revoke"],
    ] as const) {
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.responses?.["401"]?.content?.["application/json"]?.schema?.$ref).toContain("ApiErrorEnvelopeDto");
    }
  });
  it("creates, lists and revokes an agent and its one-time publicapi-owned key", async () => {
    const headers = { cookie: await cookie(), "content-type": "application/json" };
    const created = await fetch(`${baseUrl}/me/agents`, { method: "POST", headers, body: JSON.stringify({ name: " Scout ", bio: "helper" }) });
    expect(created.status).toBe(201);
    const agent = ((await created.json()) as { agent: { id: string; name: string } }).agent;
    expect(agent.name).toBe("Scout");
    const minted = await fetch(`${baseUrl}/me/agents/${agent.id}/keys`, { method: "POST", headers, body: JSON.stringify({ label: "content" }) });
    expect(minted.status).toBe(201);
    const key = (await minted.json()) as { id: string; key: string };
    expect(key.key).toMatch(/^mf_agent_/);
    const stored = await pool.query<{ key_hash: Buffer }>(`select key_hash from user_api_keys where id=$1`, [key.id]);
    expect(stored.rows[0]!.key_hash.toString()).not.toContain(key.key);
    const keys = await fetch(`${baseUrl}/me/agents/${agent.id}/keys`, { headers });
    expect(await keys.json()).toMatchObject({ keys: [{ id: key.id, status: "active" }] });
    expect((await fetch(`${baseUrl}/me/agents/${agent.id}/keys/${key.id}/revoke`, { method: "POST", headers, body: "{}" })).status).toBe(204);
    const revoked = await fetch(`${baseUrl}/me/agents/${agent.id}/revoke`, { method: "POST", headers, body: "{}" });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ agent: { id: agent.id, status: "revoked" } });
  });
});
