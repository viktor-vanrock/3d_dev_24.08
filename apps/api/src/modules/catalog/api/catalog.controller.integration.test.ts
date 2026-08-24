import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthGuard } from "../../../nest/auth/auth.guard.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { ApiExceptionFilter } from "../../../nest/errors/api-exception.filter.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { CatalogIntegrationModule } from "../../../nest/integration/catalog.adapters.ts";
import { CorrelationInterceptor } from "../../../nest/observability/correlation.interceptor.ts";
import { RequestContext } from "../../../nest/observability/request-context.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { createApiValidationPipe } from "../../../nest/validation/api-validation.pipe.ts";
import { CatalogModule } from "../catalog.module.ts";

const JWT_SECRET = "catalog-integration-test-secret";

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected JSON object");
  return value as Record<string, unknown>;
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), CatalogIntegrationModule, CatalogModule],
  providers: [
    RequestContext,
    RuntimeLogger,
    SessionVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CorrelationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: createApiValidationPipe },
  ],
})
class CatalogIntegrationTestModule {}

describe.skipIf(!process.env.DATABASE_URL)("Nest catalog read DB integration", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let pool: Pool;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.NODE_ENV = "test";
    delete process.env.CLOSED_DEV;
    delete process.env.PORTAL_PUBLIC;
    app = await createNestApp(CatalogIntegrationTestModule);
    pool = app.get<Pool>(DATABASE_POOL);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it("serves catalog-owned public reads with the legacy response shapes", async () => {
    const [releases, materials, vendors, machines] = await Promise.all([
      fetch(`${baseUrl}/releases?limit=1`),
      fetch(`${baseUrl}/materials?limit=1`),
      fetch(`${baseUrl}/vendors`),
      fetch(`${baseUrl}/machines?limit=1`),
    ]);
    expect([releases.status, materials.status, vendors.status, machines.status]).toEqual([200, 200, 200, 200]);
    const releasesBody = await jsonObject(releases);
    const materialsBody = await jsonObject(materials);
    const vendorsBody = await jsonObject(vendors);
    const machinesBody = await jsonObject(machines);
    expect(Array.isArray(releasesBody.releases)).toBe(true);
    expect(typeof releasesBody.has_more).toBe("boolean");
    expect(Array.isArray(materialsBody.materials)).toBe(true);
    expect(typeof materialsBody.total).toBe("number");
    expect(materialsBody.limit).toBe(1);
    expect(materialsBody.offset).toBe(0);
    expect(Array.isArray(vendorsBody.vendors)).toBe(true);
    expect(Array.isArray(machinesBody.machines)).toBe(true);
    expect(typeof machinesBody.has_more).toBe("boolean");
  });

  it("preserves printer query validation and the stable empty-page contract", async () => {
    const invalid = await fetch(`${baseUrl}/printers?currency=eur`);
    expect(invalid.status).toBe(400);
    const invalidBody = await jsonObject(invalid);
    const invalidError = invalidBody.error as { code?: unknown; requestId?: unknown } | undefined;
    expect(invalidError?.code).toBe("http.bad_request.v1");
    expect(typeof invalidError?.requestId).toBe("string");

    const empty = await fetch(`${baseUrl}/printers?brand=there-is-no-such-printer&limit=1`);
    expect(empty.status).toBe(200);
    expect(await jsonObject(empty)).toEqual({
      contract_version: "printers.catalog.v1",
      items: [],
      printers: [],
      has_more: false,
      next_cursor: null,
      gap_counts: {},
    });
  });

  it("preserves printer price cursor ordering and published detail", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const brand = `Nest Cursor ${suffix}`;
    const slugs = [`nest-cursor-${suffix}-one`, `nest-cursor-${suffix}-two`, `nest-cursor-${suffix}-three`];
    try {
      for (const [index, slug] of slugs.entries()) {
        await pool.query(
          `insert into printers (slug, brand, model, sources, price_ru_rub, filled_by, confidence)
           values ($1, $2, $3, array['https://example.com'], $4, 'fixture', 'high')`,
          [slug, brand, `Printer ${index + 1}`, (index + 1) * 10_000],
        );
      }
      const first = await fetch(`${baseUrl}/printers?brand=${encodeURIComponent(brand)}&sort=price_asc&limit=2`);
      const firstBody = await jsonObject(first);
      const firstPrinters = firstBody.printers as Array<{ slug?: unknown }>;
      expect(firstPrinters.map((printer) => printer.slug)).toEqual(slugs.slice(0, 2));
      expect(firstBody.has_more).toBe(true);
      expect(typeof firstBody.next_cursor).toBe("string");

      const second = await fetch(`${baseUrl}/printers?brand=${encodeURIComponent(brand)}&sort=price_asc&limit=2&cursor=${encodeURIComponent(String(firstBody.next_cursor))}`);
      const secondBody = await jsonObject(second);
      const secondPrinters = secondBody.printers as Array<{ slug?: unknown }>;
      expect(secondPrinters.map((printer) => printer.slug)).toEqual(slugs.slice(2));
      expect(secondBody.has_more).toBe(false);
      expect(secondBody.next_cursor).toBeNull();

      const detail = await fetch(`${baseUrl}/printers/${slugs[0]}`);
      expect(detail.status).toBe(200);
      const detailBody = await jsonObject(detail);
      expect((detailBody.printer as { slug?: unknown }).slug).toBe(slugs[0]);
    } finally {
      await pool.query(`delete from printers where slug = any($1::text[])`, [slugs]);
    }
  });

  it("uses the makes projection seam for machine and material details", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const vendor = await pool.query<{ id: string }>(`insert into vendors (slug, name) values ($1, $2) returning id`, [`nest-catalog-${suffix}`, `Nest Catalog ${suffix}`]);
    const vendorId = vendor.rows[0]!.id;
    const machine = await pool.query<{ id: string }>(`insert into machines (kind, vendor_id, model, status) values ('fdm_printer', $1, $2, 'active') returning id`, [
      vendorId,
      `Nest Machine ${suffix}`,
    ]);
    const machineId = machine.rows[0]!.id;
    const materialType = await pool.query<{ id: string }>(`insert into material_types (slug, name) values ($1, $2) returning id`, [`nest-pla-${suffix}`, `Nest PLA ${suffix}`]);
    const materialTypeId = materialType.rows[0]!.id;
    const material = await pool.query<{ id: string }>(
      `insert into materials (kind, vendor_id, material_type_id, slug, name)
       values ('filament', $1, $2, $3, $4) returning id`,
      [vendorId, materialTypeId, `nest-material-${suffix}`, `Nest Material ${suffix}`],
    );
    const materialId = material.rows[0]!.id;
    try {
      const [machineResponse, materialResponse] = await Promise.all([fetch(`${baseUrl}/machines/${machineId}`), fetch(`${baseUrl}/materials/${materialId}`)]);
      expect([machineResponse.status, materialResponse.status]).toEqual([200, 200]);
      const machineBody = await jsonObject(machineResponse);
      const materialBody = await jsonObject(materialResponse);
      expect((machineBody.machine as { make_stats?: unknown }).make_stats).toEqual({ make_count: 0, model_count: 0 });
      expect((materialBody.material as { make_stats?: unknown }).make_stats).toEqual({ make_count: 0, model_count: 0 });
      expect(machineBody.makes_has_more).toBe(false);
      expect(materialBody.makes_has_more).toBe(false);
    } finally {
      await pool.query(`delete from materials where id = $1`, [materialId]);
      await pool.query(`delete from material_types where id = $1`, [materialTypeId]);
      await pool.query(`delete from machines where id = $1`, [machineId]);
      await pool.query(`delete from vendors where id = $1`, [vendorId]);
    }
  });

  it("returns versioned 404 errors and authenticated catalog metrics", async () => {
    const missing = await fetch(`${baseUrl}/materials/not-a-uuid`);
    expect(missing.status).toBe(404);
    const missingBody = await jsonObject(missing);
    const missingError = missingBody.error as { code?: unknown } | undefined;
    expect(missingError?.code).toBe("http.not_found.v1");

    const token = await new SignJWT({ username: "catalog-test" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("00000000-0000-4000-8000-000000000001")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(JWT_SECRET));
    const metrics = await fetch(`${baseUrl}/catalog/metrics`, { headers: { cookie: `portal_session=${token}` } });
    expect(metrics.status).toBe(200);
    const metricsBody = await jsonObject(metrics);
    expect(typeof metricsBody.total_models).toBe("number");
    expect(typeof metricsBody.complete_specs_pct).toBe("number");
    expect(typeof metricsBody.verified_pct).toBe("number");
  });

  it("preserves candidate create, queue, reject, approve, and community side effects", async () => {
    const userId = "00000000-0000-4000-8000-000000000001";
    const token = await new SignJWT({ username: "catalog-candidate-test" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(JWT_SECRET));
    const headers = { cookie: `portal_session=${token}`, "content-type": "application/json" };
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let materialCandidateId: string | undefined;
    let machineCandidateId: string | undefined;
    let machineId: string | undefined;
    try {
      const invalid = await fetch(`${baseUrl}/material-candidates`, { method: "POST", headers, body: JSON.stringify({ vendor: "Vendor" }) });
      expect(invalid.status).toBe(422);
      expect(((await jsonObject(invalid)).error as { code?: unknown }).code).toBe("validation.invalid.v1");

      const materialCreate = await fetch(`${baseUrl}/material-candidates`, {
        method: "POST",
        headers,
        body: JSON.stringify({ vendor: `Nest Material ${suffix}`, material_type: "PLA", color_name: "Blue" }),
      });
      expect(materialCreate.status).toBe(201);
      materialCandidateId = String((await jsonObject(materialCreate)).id);
      const queue = await fetch(`${baseUrl}/material-candidates?status=pending`, { headers });
      expect(queue.status).toBe(200);
      expect((await jsonObject(queue)).status).toBe("pending");
      expect((await fetch(`${baseUrl}/material-candidates/${materialCandidateId}/reject`, { method: "POST", headers })).status).toBe(200);
      const duplicateReject = await fetch(`${baseUrl}/material-candidates/${materialCandidateId}/reject`, { method: "POST", headers });
      expect(duplicateReject.status).toBe(409);
      expect(((await jsonObject(duplicateReject)).error as { code?: unknown }).code).toBe("http.client_error.v1");

      const machineCreate = await fetch(`${baseUrl}/machine-candidates`, {
        method: "POST",
        headers,
        body: JSON.stringify({ vendor: `Nest Vendor ${suffix}`, model: `Nest Machine ${suffix}` }),
      });
      expect(machineCreate.status).toBe(201);
      machineCandidateId = String((await jsonObject(machineCreate)).id);
      const approved = await fetch(`${baseUrl}/machine-candidates/${machineCandidateId}/approve`, { method: "POST", headers });
      expect(approved.status).toBe(200);
      const approvedBody = await jsonObject(approved);
      machineId = String(approvedBody.machine_id);
      expect(approvedBody.status).toBe("merged");
      const communities = await pool.query<{ kind: string }>(`select kind from communities where subject_id = $1 order by kind`, [machineId]);
      expect(communities.rows.map((row) => row.kind)).toEqual(["machine"]);
    } finally {
      if (machineCandidateId !== undefined) await pool.query(`delete from machine_candidates where id = $1`, [machineCandidateId]);
      if (machineId !== undefined) {
        const vendor = await pool.query<{ vendor_id: string }>(`select vendor_id from machines where id = $1`, [machineId]);
        const vendorId = vendor.rows[0]?.vendor_id;
        await pool.query(`delete from communities where subject_id = $1 or subject_id = $2`, [machineId, vendorId ?? null]);
        await pool.query(`delete from machines where id = $1`, [machineId]);
        if (vendorId !== undefined) await pool.query(`delete from vendors where id = $1`, [vendorId]);
      }
      if (materialCandidateId !== undefined) await pool.query(`delete from material_candidates where id = $1`, [materialCandidateId]);
    }
  });
});
