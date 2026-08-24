import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { SESSION_COOKIE_NAME } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

const JWT_SECRET = "nest-profile-integration-secret";
const userId = randomUUID();
const username = `nest-profile-http-${randomUUID()}`;

async function cookie(): Promise<string> {
  const token = await new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("Nest profile core HTTP migration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await pool.query(`insert into users (id, username, reputation_score, trust_level) values ($1, $2, 42, 2)`, [userId, username]);
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest profile test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await pool.query(`delete from users where id = $1`, [userId]);
  });

  it("preserves session decisions and returns the versioned error envelope", async () => {
    const profile = await fetch(`${baseUrl}/users/${username}`);
    expect(profile.status).toBe(401);
    const profileError = (await profile.json()) as { error: { code: string; requestId: string } };
    expect(profileError.error.code).toBe("auth.unauthorized.v1");
    expect(profileError.error.requestId).not.toBe("");

    const avatar = await fetch(`${baseUrl}/me/avatar`);
    expect(avatar.status).toBe(401);
    await expect(avatar.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });

    const photo = await fetch(`${baseUrl}/avatars/${userId}`);
    expect(photo.status).toBe(401);
  });

  it("serves the profile and lazily materializes a stable mascot", async () => {
    const headers = { cookie: await cookie() };
    const response = await fetch(`${baseUrl}/users/${username}`, { headers });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { id: userId, reputation_score: 42, trust_level: 2, models_count: 0 },
    });

    const first = await fetch(`${baseUrl}/me/avatar`, { headers });
    const second = await fetch(`${baseUrl}/me/avatar`, { headers });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { config: Record<string, string>; revision: number };
    const secondBody = (await second.json()) as { config: Record<string, string> };
    expect(firstBody.revision).toBe(1);
    expect(secondBody.config).toEqual(firstBody.config);
  });

  it("keeps legacy business validation status while using the common body", async () => {
    const response = await fetch(`${baseUrl}/me`, {
      method: "PATCH",
      headers: { cookie: await cookie(), "content-type": "application/json" },
      body: JSON.stringify({ username: "Not Valid!" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "http.bad_request.v1" } });
  });

  it("updates the owned users row and leaves snapshot reads public", async () => {
    const changedUsername = `changed.${randomUUID().slice(0, 8)}`;
    const response = await fetch(`${baseUrl}/me`, {
      method: "PATCH",
      headers: { cookie: await cookie(), "content-type": "application/json" },
      body: JSON.stringify({ username: changedUsername, display_name: "  Maker  " }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { username: changedUsername, display_name: "Maker", handle_confirmed: true },
    });

    const snapshot = await fetch(`${baseUrl}/avatars/${userId}/snapshots/front`, { redirect: "manual" });
    expect(snapshot.status).toBe(404);
    await expect(snapshot.json()).resolves.toMatchObject({ error: { code: "http.not_found.v1" } });
  });
});
