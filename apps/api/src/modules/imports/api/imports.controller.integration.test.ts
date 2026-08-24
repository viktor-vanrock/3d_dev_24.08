import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

const JWT_SECRET = "nest-imports-domain-test-secret";
const canRunIntegration = Boolean(process.env.DATABASE_URL);
const userIds: string[] = [];
let app: NestExpressApplication;
let baseUrl: string;

async function createUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-imports-${randomUUID()}`]);
  const id = result.rows[0]!.id;
  userIds.push(id);
  return id;
}

async function createConnection(userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into import_connections (user_id, source_platform, credential_enc, ownership_status, status)
     values ($1, 'cults3d', $2, 'verified', 'active') returning id`,
    [userId, Buffer.from("test")],
  );
  return result.rows[0]!.id;
}

async function cookie(userId: string): Promise<string> {
  const token = await new SignJWT({ username: "imports-tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

describe.skipIf(!canRunIntegration)("Nest imports domain migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest imports test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (userIds.length === 0) return;
    await pool.query(`delete from users where id = any($1::uuid[])`, [userIds]);
    userIds.length = 0;
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    delete process.env.JWT_SECRET;
  });

  it("keeps all three routes authenticated with the versioned error envelope", async () => {
    for (const request of [
      fetch(`${baseUrl}/me/imports/jobs`),
      fetch(`${baseUrl}/me/imports/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      fetch(`${baseUrl}/me/imports/jobs/${randomUUID()}`),
    ]) {
      const response = await request;
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
    }
  });

  it("preserves 400 validation decisions and the 404 connection decision", async () => {
    const userId = await createUser();
    const headers = { cookie: await cookie(userId), "content-type": "application/json" };
    for (const body of [
      {},
      { connection_id: randomUUID(), source_platform: "", external_ids: ["x"] },
      { connection_id: randomUUID(), source_platform: "cults3d", external_ids: [] },
    ]) {
      const response = await fetch(`${baseUrl}/me/imports/jobs`, { method: "POST", headers, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "http.bad_request.v1" } });
    }
    const missing = await fetch(`${baseUrl}/me/imports/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ connection_id: randomUUID(), source_platform: "cults3d", external_ids: ["x"] }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "http.not_found.v1" } });
  });

  it("keeps create, list, and detail success shapes", async () => {
    const userId = await createUser();
    const connectionId = await createConnection(userId);
    const headers = { cookie: await cookie(userId), "content-type": "application/json" };
    const created = await fetch(`${baseUrl}/me/imports/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ connection_id: connectionId, source_platform: "cults3d", external_ids: ["a", "b", "a"] }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as Record<string, unknown>;
    expect(Object.keys(createdBody).sort()).toEqual(["done_count", "failed_count", "id", "status", "total_count"]);
    expect(createdBody).toMatchObject({ status: "queued", total_count: 2, done_count: 0, failed_count: 0 });

    const list = await fetch(`${baseUrl}/me/imports/jobs`, { headers });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { jobs: Array<{ id: string }> };
    expect(listBody.jobs.map((job) => job.id)).toContain(createdBody.id);

    const detail = await fetch(`${baseUrl}/me/imports/jobs/${String(createdBody.id)}`, { headers });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { items: unknown[] };
    expect(detailBody.items).toHaveLength(2);
  });
});
