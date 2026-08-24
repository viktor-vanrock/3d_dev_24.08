import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

const JWT_SECRET = process.env.JWT_SECRET ?? "nest-master-services-test-secret";

async function sessionCookie(userId: string): Promise<string> {
  const token = await new SignJWT({ username: "master-services-http" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

describe("Nest masterServices HTTP contract", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let userId: string;
  let materialId: string;
  let materialTypeId: string;
  let vendorId: string;
  let serviceId: string | undefined;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.NODE_ENV = "test";
    const suffix = randomUUID();
    userId = (await pool.query<{ id: string }>("insert into users(username) values($1) returning id", [`master-services-http-${suffix}`])).rows[0]!.id;
    vendorId = (await pool.query<{ id: string }>("insert into vendors(slug,name) values($1,$2) returning id", [`master-services-vendor-${suffix}`, "HTTP vendor"])).rows[0]!.id;
    materialTypeId = (
      await pool.query<{ id: string }>("insert into material_types(slug,name) values($1,$2) returning id", [`master-services-type-${suffix}`, "HTTP material type"])
    ).rows[0]!.id;
    materialId = (
      await pool.query<{ id: string }>("insert into materials(kind,vendor_id,material_type_id,slug,name) values('filament',$1,$2,$3,$4) returning id", [
        vendorId,
        materialTypeId,
        `master-services-material-${suffix}`,
        "HTTP material",
      ])
    ).rows[0]!.id;

    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("masterServices test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (serviceId !== undefined) await pool.query("delete from master_services where id=$1", [serviceId]);
    if (materialId !== undefined) await pool.query("delete from materials where id=$1", [materialId]);
    if (materialTypeId !== undefined) await pool.query("delete from material_types where id=$1", [materialTypeId]);
    if (vendorId !== undefined) await pool.query("delete from vendors where id=$1", [vendorId]);
    if (userId !== undefined) await pool.query("delete from users where id=$1", [userId]);
    delete process.env.JWT_SECRET;
  });

  it("publishes exactly the five migrated operations and versioned error envelopes", async () => {
    const unauthorized = await fetch(`${baseUrl}/master-services`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Unauthorized", technology: "fdm" }),
    });
    expect(unauthorized.status).toBe(401);
    const unauthorizedBody = (await unauthorized.json()) as { error?: { code?: unknown; requestId?: unknown } };
    expect(unauthorizedBody.error?.code).toBe("auth.unauthorized.v1");
    expect(typeof unauthorizedBody.error?.requestId).toBe("string");

    const missing = await fetch(`${baseUrl}/master-services/${randomUUID()}`);
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { error?: { code?: unknown; requestId?: unknown } };
    expect(typeof missingBody.error?.code).toBe("string");
    expect(typeof missingBody.error?.requestId).toBe("string");

    const document = (await (await fetch(`${baseUrl}/openapi.json`)).json()) as {
      paths?: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
    };
    const routes = [
      ["post", "/master-services"],
      ["patch", "/master-services/{id}"],
      ["delete", "/master-services/{id}"],
      ["get", "/master-services/{id}"],
      ["get", "/masters/{masterId}/services"],
    ] as const;
    for (const [method, path] of routes) {
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.responses?.["404"]?.content?.["application/json"]?.schema?.$ref).toContain("ApiErrorEnvelopeDto");
    }
    expect(document.paths?.["/master-services"]?.post?.responses?.["401"]?.content?.["application/json"]?.schema?.$ref).toContain("ApiErrorEnvelopeDto");
  });

  it("preserves create, public reads, update, delete and status decisions", async () => {
    const cookie = await sessionCookie(userId);
    const created = await fetch(`${baseUrl}/master-services`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        title: " HTTP FDM ",
        technology: "fdm",
        priceMinMinor: 1000,
        priceMaxMinor: 2000,
        leadTimeDaysMin: 1,
        leadTimeDaysMax: 3,
        materialIds: [materialId],
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; title: string; material_ids: string[] };
    serviceId = createdBody.id;
    expect(createdBody).toMatchObject({ title: "HTTP FDM", material_ids: [materialId] });

    const detail = await fetch(`${baseUrl}/master-services/${serviceId}`);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({ id: serviceId, master_id: userId });

    const list = await fetch(`${baseUrl}/masters/${userId}/services?limit=1&offset=0`);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      services: [expect.objectContaining({ id: serviceId })],
      limit: 1,
      offset: 0,
      has_more: false,
    });

    const invalidRange = await fetch(`${baseUrl}/master-services/${serviceId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ priceMinMinor: 3000 }),
    });
    expect(invalidRange.status).toBe(400);

    const updated = await fetch(`${baseUrl}/master-services/${serviceId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ priceMaxMinor: 4000, materialIds: [] }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ price_max_minor: 4000, material_ids: [] });

    const deleted = await fetch(`${baseUrl}/master-services/${serviceId}`, { method: "DELETE", headers: { cookie } });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ ok: true });
    expect((await fetch(`${baseUrl}/master-services/${serviceId}`)).status).toBe(404);
  });
});
