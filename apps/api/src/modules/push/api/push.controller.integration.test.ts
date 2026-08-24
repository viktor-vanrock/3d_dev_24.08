import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { SubscribePushDto } from "./push.dto.ts";

const JWT_SECRET = "nest-push-domain-test-secret";
const userIds: string[] = [];
let app: NestExpressApplication;
let baseUrl: string;

async function createUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-push-${randomUUID()}`]);
  const id = result.rows[0]!.id;
  userIds.push(id);
  return id;
}

async function cookie(userId: string): Promise<string> {
  const token = await new SignJWT({ username: "tester", sv: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

describe("Nest push domain migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest push test server did not bind a port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (userIds.length === 0) return;
    await pool.query(`delete from users where id = any($1::uuid[])`, [userIds]);
    userIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it("preserves auth deny status and uses the versioned envelope", async () => {
    const response = await api("/push/vapid-public-key");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
  });

  it("returns the VAPID public key contract and keeps malformed subscriptions on the 422 boundary", async () => {
    const session = await cookie(await createUser());
    const key = await api("/push/vapid-public-key", { headers: { cookie: session } });
    expect(key.status).toBe(200);
    await expect(key.json()).resolves.toEqual({ public_key: null });

    await expect(
      createApiValidationPipe().transform({ endpoint: "https://push.example/missing-keys" }, { type: "body", metatype: SubscribePushDto, data: undefined }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("upserts and removes a subscription by endpoint", async () => {
    const session = await cookie(await createUser());
    const endpoint = `https://push.example/${randomUUID()}`;
    for (const suffix of ["a", "b"]) {
      const response = await api("/push/subscriptions", {
        method: "POST",
        headers: { cookie: session, "content-type": "application/json", "user-agent": "nest-domain-test" },
        body: JSON.stringify({ endpoint, keys: { p256dh: `key-${suffix}`, auth: `auth-${suffix}` } }),
      });
      expect(response.status).toBe(201);
    }

    const rows = await pool.query<{ p256dh: string; user_agent: string }>(`select p256dh, user_agent from push_subscriptions where endpoint = $1`, [endpoint]);
    expect(rows.rows).toEqual([{ p256dh: "key-b", user_agent: "nest-domain-test" }]);

    const removed = await api("/push/subscriptions", {
      method: "DELETE",
      headers: { cookie: session, "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    expect(removed.status).toBe(200);
    expect((await pool.query(`select 1 from push_subscriptions where endpoint = $1`, [endpoint])).rowCount).toBe(0);
  });

  it("returns all default preferences and persists an override", async () => {
    const session = await cookie(await createUser());
    const headers = { cookie: session, "content-type": "application/json" };
    const before = await api("/push/preferences", { headers });
    const beforeBody = (await before.json()) as { preferences: Array<{ type: string; enabled: boolean }> };
    expect(before.status).toBe(200);
    expect(beforeBody.preferences).toHaveLength(6);
    expect(beforeBody.preferences.every(({ enabled }) => enabled)).toBe(true);

    const updated = await api("/push/preferences", {
      method: "PUT",
      headers,
      body: JSON.stringify({ type: "comment", enabled: false }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toEqual({ type: "comment", enabled: false });

    const after = (await (await api("/push/preferences", { headers })).json()) as {
      preferences: Array<{ type: string; enabled: boolean }>;
    };
    expect(after.preferences.find(({ type }) => type === "comment")?.enabled).toBe(false);
    expect(after.preferences.find(({ type }) => type === "like")?.enabled).toBe(true);
  });
});
