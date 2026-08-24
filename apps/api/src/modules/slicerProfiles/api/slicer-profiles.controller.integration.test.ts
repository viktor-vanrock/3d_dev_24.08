import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

const JWT_SECRET = "nest-slicer-profiles-test-secret";
const suffix = randomUUID();
let app: NestExpressApplication;
let baseUrl: string;
let userId: string;
let machineId: string;
let materialId: string;
let materialTypeId: string;
let vendorId: string;
let profileId: string;

async function bearer(): Promise<string> {
  const token = await new SignJWT({ username: "slicer-tester" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `Bearer ${token}`;
}

describe("Nest slicerProfiles domain migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    userId = (await pool.query<{ id: string }>(`insert into users (username) values ($1) returning id`, [`nest-slicer-http-${suffix}`])).rows[0]!.id;
    machineId = (
      await pool.query<{ id: string }>(
        `insert into machines (kind, model, status, specs)
       values ('fdm_printer', $1, 'active', $2) returning id`,
        [`Nest HTTP ${suffix}`, { nozzle_diameter_mm: 0.4, kinematics: "corexy" }],
      )
    ).rows[0]!.id;
    vendorId = (await pool.query<{ id: string }>(`insert into vendors (slug, name) values ($1, 'Nest HTTP') returning id`, [`nest-http-${suffix}`])).rows[0]!.id;
    materialTypeId = (await pool.query<{ id: string }>(`insert into material_types (slug, name) values ($1, 'PLA') returning id`, [`pla-http-${suffix}`])).rows[0]!.id;
    materialId = (
      await pool.query<{ id: string }>(
        `insert into materials (vendor_id, material_type_id, slug, name, kind, specs)
       values ($1, $2, $3, 'PLA', 'filament', $4) returning id`,
        [vendorId, materialTypeId, `pla-http-${suffix}`, { material_class: "pla", diameter_mm: 1.75 }],
      )
    ).rows[0]!.id;
    profileId = (
      await pool.query<{ id: string }>(
        `insert into slicer_profiles
         (profile_class, slicer, name, machine_id, params, source_name, source_ref, license, confidence)
       values ('process', 'prusaslicer', $1, $2, $3, 'PrusaSlicer', 'test', 'AGPL-3.0-or-later', 1)
       returning id`,
        [`Nest process ${suffix}`, machineId, { nozzle_diameter_mm: 0.4, kinematics: "corexy" }],
      )
    ).rows[0]!.id;

    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest slicer profile test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await pool.query(`delete from slicer_profile_calibrations where slicer_profile_id = $1`, [profileId]);
    await pool.query(`delete from slicer_profiles where id = $1`, [profileId]);
    await pool.query(`delete from materials where id = $1`, [materialId]);
    await pool.query(`delete from material_types where id = $1`, [materialTypeId]);
    await pool.query(`delete from vendors where id = $1`, [vendorId]);
    await pool.query(`delete from machines where id = $1`, [machineId]);
    await pool.query(`delete from users where id = $1`, [userId]);
    delete process.env.JWT_SECRET;
  });

  it("keeps all four route families behind the global auth guard", async () => {
    for (const path of ["/slicer-profiles?class=process", `/slicer-profiles/${machineId}/${materialId}`, `/slicer-profiles/${profileId}/calibrations`]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "auth.unauthorized.v1" } });
    }
  });

  it("lists and recommends the active profile through owner read ports", async () => {
    const authorization = await bearer();
    const list = await fetch(`${baseUrl}/slicer-profiles?class=process`, { headers: { authorization } });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { profiles: Array<{ id: string }> };
    expect(listBody.profiles).toContainEqual(expect.objectContaining({ id: profileId }));

    const recommendation = await fetch(`${baseUrl}/slicer-profiles/${machineId}/${materialId}?intent=appearance`, { headers: { authorization } });
    expect(recommendation.status).toBe(200);
    await expect(recommendation.json()).resolves.toMatchObject({
      contract_version: "slicer.profile-recommendation.v1",
      printer_id: machineId,
      filament_id: materialId,
      intent: "appearance",
    });
  });

  it("creates and reads an append-only calibration", async () => {
    const authorization = await bearer();
    const created = await fetch(`${baseUrl}/slicer-profiles/${profileId}/calibrations`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        machine_id: machineId,
        material_id: materialId,
        flow_ratio: 0.97,
        pressure_advance: 0.045,
        outcome: "success",
        notes: "HTTP verified",
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      slicer_profile_id: profileId,
      machine_id: machineId,
      material_id: materialId,
      flow_ratio: 0.97,
      pressure_advance: 0.045,
      outcome: "success",
    });

    const listed = await fetch(`${baseUrl}/slicer-profiles/${profileId}/calibrations`, {
      headers: { authorization },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { calibrations: Array<{ notes: string | null }> };
    expect(body.calibrations).toContainEqual(expect.objectContaining({ notes: "HTTP verified" }));
  });
});
