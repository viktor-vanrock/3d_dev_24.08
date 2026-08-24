import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

const JWT_SECRET = "nest-moderation-domain-test-secret";
const staffId = randomUUID();
const userId = randomUUID();
const targetId = randomUUID();
let app: NestExpressApplication;
let baseUrl: string;

async function bearer(id: string): Promise<string> {
  const token = await new SignJWT({ username: "moderation-tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `Bearer ${token}`;
}

describe("Nest moderation domain migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await pool.query(`insert into users (id, username, is_staff) values ($1, $2, true), ($3, $4, false), ($5, $6, false)`, [
      staffId,
      `mod-staff-${randomUUID()}`,
      userId,
      `mod-user-${randomUUID()}`,
      targetId,
      `mod-target-${randomUUID()}`,
    ]);
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest moderation test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await pool.query(`delete from users where id = any($1::uuid[])`, [[staffId, userId, targetId]]);
    delete process.env.JWT_SECRET;
  });

  it("preserves the staff decision and versioned 403 envelope", async () => {
    const response = await fetch(`${baseUrl}/users/${targetId}/ban`, {
      method: "POST",
      headers: { authorization: await bearer(userId), "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.forbidden.v1" } });
  });

  it("returns the versioned 404 class for malformed and missing targets", async () => {
    for (const id of ["not-a-uuid", randomUUID()]) {
      const response = await fetch(`${baseUrl}/users/${id}/ban`, {
        method: "POST",
        headers: { authorization: await bearer(staffId), "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "http.not_found.v1" } });
    }
  });

  it("anonymizes once and keeps repeated bans idempotent", async () => {
    const call = async () =>
      fetch(`${baseUrl}/users/${targetId}/ban`, {
        method: "POST",
        headers: { authorization: await bearer(staffId), "content-type": "application/json" },
        body: JSON.stringify({ reason: "spam" }),
      });
    const first = await call();
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ id: targetId, status: "banned" });
    const afterFirst = await pool.query<{ status: string; username: string; display_name: string | null }>(`select status, username, display_name from users where id = $1`, [
      targetId,
    ]);
    expect(afterFirst.rows[0]).toMatchObject({ status: "banned", display_name: null });
    expect(afterFirst.rows[0]!.username).toMatch(/^deleted\.[0-9a-f]{12}$/);

    const second = await call();
    expect(second.status).toBe(200);
    expect((await pool.query<{ username: string }>(`select username from users where id = $1`, [targetId])).rows[0]!.username).toBe(afterFirst.rows[0]!.username);
  });
});
