import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

const JWT_SECRET = "nest-generations-db-test-secret";
const suite = process.env.DATABASE_URL ? describe : describe.skip;
async function cookie(userId: string): Promise<string> {
  const token = await new SignJWT({ username: "generation-tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

suite("Nest generations DB contract", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let userId: string;
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.NODE_ENV = "test";
    userId = (await pool.query<{ id: string }>(`insert into users(username) values($1) returning id`, [`nest-generations-${Date.now()}`])).rows[0]!.id;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await pool.query(`delete from generations_idempotency where owner_id=$1`, [userId]);
    await pool.query(`delete from generations where user_id=$1`, [userId]);
    await pool.query(`delete from users where id=$1`, [userId]);
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it("creates, idempotently replays, lists and reads an owned generation", async () => {
    const headers = { cookie: await cookie(userId), "content-type": "application/json", "idempotency-key": "nest-generation-replay" };
    const payload = JSON.stringify({ branch: "openscad", prompt: "  calibration cube  ", params: { size: 20 } });
    const first = await fetch(`${baseUrl}/generations`, { method: "POST", headers, body: payload });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { generation: { id: string; prompt: string; status: string } };
    expect(firstBody.generation).toMatchObject({ prompt: "calibration cube", status: "queued" });
    const replay = await fetch(`${baseUrl}/generations`, { method: "POST", headers, body: payload });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstBody);
    const detail = await fetch(`${baseUrl}/generations/${firstBody.generation.id}`, { headers: { cookie: await cookie(userId) } });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ generation: { id: firstBody.generation.id } });
    const list = await fetch(`${baseUrl}/generations`, { headers: { cookie: await cookie(userId) } });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { generations: Array<{ id: string }> };
    expect(listed.generations.filter((row) => row.id === firstBody.generation.id)).toHaveLength(1);
  });

  it("keeps the invalid branch status while returning the versioned envelope", async () => {
    const response = await fetch(`${baseUrl}/generations`, {
      method: "POST",
      headers: { cookie: await cookie(userId), "content-type": "application/json" },
      body: JSON.stringify({ branch: "concepts", prompt: "x" }),
    });
    expect(response.status).toBe(422);
    const payload = await response.text();
    expect(payload).toContain('"code":"validation.invalid.v1"');
    expect(payload).toContain('"requestId":');
  });
});
