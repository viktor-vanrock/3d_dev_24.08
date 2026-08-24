import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { SESSION_COOKIE_NAME } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

const JWT_SECRET = "nest-profile-inventory-secret";
const userId = randomUUID();
const username = `inventory.${randomUUID().slice(0, 8)}`;
let app: NestExpressApplication;
let baseUrl: string;

async function sessionCookie(): Promise<string> {
  const token = await new SignJWT({ username }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("1h").sign(new TextEncoder().encode(JWT_SECRET));
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("Nest profile activation and inventory HTTP migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await pool.query(`insert into users (id, username) values ($1, $2)`, [userId, username]);
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest profile inventory test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await pool.query(`delete from user_printers where user_id = $1`, [userId]);
    await pool.query(`delete from user_activation where user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  });

  it("preserves the session decision and versioned 401 envelope", async () => {
    const response = await fetch(`${baseUrl}/me/activation`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
  });

  it("lazily initializes activation and returns empty owner-backed inventories", async () => {
    const response = await fetch(`${baseUrl}/me/activation`, { headers: { cookie: await sessionCookie() } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activation: { user_id: userId, state: "first_run", sessions_seen: 1 },
      printers: [],
      filaments: [],
    });

    const materials = await fetch(`${baseUrl}/me/materials`, { headers: { cookie: await sessionCookie() } });
    const filaments = await fetch(`${baseUrl}/me/filaments`, { headers: { cookie: await sessionCookie() } });
    await expect(materials.json()).resolves.toEqual({ materials: [] });
    await expect(filaments.json()).resolves.toEqual({ filaments: [] });
  });

  it("updates activation and maps business rejection to the common envelope", async () => {
    const headers = { cookie: await sessionCookie(), "content-type": "application/json" };
    const updated = await fetch(`${baseUrl}/me/activation`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ primary_persona: "maker", home_tier: "home" }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      activation: { primary_persona: "maker", persona_source: "declared", home_tier: "home" },
    });

    const rejected = await fetch(`${baseUrl}/me/activation/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ event_name: "not_allowed" }),
    });
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: "http.bad_request.v1" } });
  });

  it("serves the owner-backed printer CRUD, compatibility, live and command surfaces", async () => {
    const headers = { cookie: await sessionCookie(), "content-type": "application/json" };
    const created = await fetch(`${baseUrl}/me/printers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ brand: "Prusa", model: "MK4", link_source: "manual" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { printer: { id: string; brand: string; model: string; is_primary: boolean } };
    expect(createdBody.printer).toMatchObject({ brand: "Prusa", model: "MK4", is_primary: true });

    const id = createdBody.printer.id;
    const listed = await fetch(`${baseUrl}/me/printers`, { headers: { cookie: await sessionCookie() } });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ printers: [{ id, brand: "Prusa", model: "MK4" }] });

    const compatibility = await fetch(`${baseUrl}/me/printers/${id}/compat`, { headers: { cookie: await sessionCookie() } });
    expect(compatibility.status).toBe(200);
    await expect(compatibility.json()).resolves.toMatchObject({ printer_id: id, verdict: "ok", reasons: [] });

    const live = await fetch(`${baseUrl}/me/printers/${id}/live`, { headers: { cookie: await sessionCookie() } });
    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toMatchObject({ live: false, state: "offline" });

    const unknownCommand = await fetch(`${baseUrl}/me/printers/${id}/commands`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "profile-printer-command" },
      body: JSON.stringify({ command: "resume" }),
    });
    expect(unknownCommand.status).toBe(400);
    await expect(unknownCommand.json()).resolves.toMatchObject({ error: { code: "http.bad_request.v1" } });

    const removed = await fetch(`${baseUrl}/me/printers/${id}`, { method: "DELETE", headers: { cookie: await sessionCookie() } });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toEqual({ ok: true });
  });
});
