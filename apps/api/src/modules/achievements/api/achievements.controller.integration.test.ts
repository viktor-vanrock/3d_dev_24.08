import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { ACHIEVEMENTS_PORT, type AchievementsPort } from "../public/index.ts";

const JWT_SECRET = "nest-achievements-domain-test-secret";
const canRunIntegration = Boolean(process.env.DATABASE_URL);
const userIds: string[] = [];
let app: NestExpressApplication;
let baseUrl: string;

async function createUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-achievements-${randomUUID()}`]);
  const id = result.rows[0]!.id;
  userIds.push(id);
  return id;
}

async function cookie(userId: string): Promise<string> {
  const token = await new SignJWT({ username: "achievements-tester", sv: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

describe.skipIf(!canRunIntegration)("Nest achievements domain migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest achievements test server did not bind");
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

  it("keeps both routes behind the global auth guard", async () => {
    for (const path of ["/me/achievements", "/me/wardrobe/unlocks"]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
    }
  });

  it("returns the characterized achievement list contract", async () => {
    const userId = await createUser();
    const headers = { cookie: await cookie(userId) };
    const before = await fetch(`${baseUrl}/me/achievements`, { headers });
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toEqual({ achievements: [] });

    const achievements = app.get<AchievementsPort>(ACHIEVEMENTS_PORT);
    await expect(achievements.grantAchievement(UserId(userId), "first_make")).resolves.toBe(true);
    await expect(achievements.grantAchievement(UserId(userId), "first_make")).resolves.toBe(false);

    const after = await fetch(`${baseUrl}/me/achievements`, { headers });
    const afterBody = (await after.json()) as {
      achievements: Array<{ slug: string; title: string; granted_at: unknown }>;
    };
    expect(afterBody.achievements).toHaveLength(1);
    expect(afterBody.achievements[0]).toMatchObject({ slug: "first_make", title: "Первый Make" });
    expect(typeof afterBody.achievements[0]!.granted_at).toBe("string");
  });

  it("unlocks only rewards backed by earned achievements", async () => {
    const userId = await createUser();
    const headers = { cookie: await cookie(userId) };
    const before = (await (await fetch(`${baseUrl}/me/wardrobe/unlocks`, { headers })).json()) as {
      layers: { outfit: string[] };
      rewards: unknown[];
    };
    expect(before.layers.outfit).toContain("none");
    expect(before.layers.outfit).not.toContain("apron");
    expect(before.rewards).toEqual([]);

    await app.get<AchievementsPort>(ACHIEVEMENTS_PORT).grantAchievement(UserId(userId), "first_make");

    const after = (await (await fetch(`${baseUrl}/me/wardrobe/unlocks`, { headers })).json()) as {
      layers: { outfit: string[] };
      rewards: unknown[];
    };
    expect(after.layers.outfit).toContain("apron");
    expect(after.rewards).toEqual([expect.objectContaining({ achievement_slug: "first_make", layer: "outfit", option_id: "apron" })]);
  });
});
