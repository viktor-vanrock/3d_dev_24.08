import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";

const JWT_SECRET = "nest-organizations-test-secret";
const canRun = Boolean(process.env.DATABASE_URL);
let app: NestExpressApplication;
let baseUrl: string;
let claimantId: string;
let staffId: string;
let nonStaffId: string;
let vendorId: string;
let machineId: string;
let vendorCommunityId: string;
let machineCommunityId: string;
let customCommunityId: string;

async function cookie(userId: string, username: string): Promise<string> {
  const token = await new SignJWT({ username, sv: 1 }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("5m").sign(new TextEncoder().encode(JWT_SECRET));
  return `portal_session=${token}`;
}

async function insertUser(label: string, staff = false): Promise<string> {
  return (await pool.query<{ id: string }>(`insert into users (username, is_staff) values ($1, $2) returning id`, [`nest-org-${label}-${randomUUID()}`, staff])).rows[0]!.id;
}

describe.skipIf(!canRun)("Nest organizations migration", () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    claimantId = await insertUser("claimant");
    staffId = await insertUser("staff", true);
    nonStaffId = await insertUser("non-staff");
    vendorId = (await pool.query<{ id: string }>(`insert into vendors (slug, name) values ($1, $1) returning id`, [`nest-org-vendor-${randomUUID()}`])).rows[0]!.id;
    machineId = (
      await pool.query<{ id: string }>(
        `insert into machines (craft, kind, vendor_id, model, specs, field_provenance, status, source)
         values ('3d_printing', 'fdm_printer', $1, $2, '{}'::jsonb, '{}'::jsonb, 'active', 'community')
         returning id`,
        [vendorId, `nest-org-machine-${randomUUID()}`],
      )
    ).rows[0]!.id;
    vendorCommunityId = (
      await pool.query<{ id: string }>(
        `insert into communities (slug, name, kind, subject_type, subject_id)
         values ($1, $1, 'vendor', 'vendor', $2) returning id`,
        [`nest-org-vendor-community-${randomUUID()}`, vendorId],
      )
    ).rows[0]!.id;
    machineCommunityId = (
      await pool.query<{ id: string }>(
        `insert into communities (slug, name, kind, subject_type, subject_id)
         values ($1, $1, 'machine', 'machine', $2) returning id`,
        [`nest-org-machine-community-${randomUUID()}`, machineId],
      )
    ).rows[0]!.id;
    customCommunityId = (await pool.query<{ id: string }>(`insert into communities (slug, name, kind) values ($1, $1, 'custom') returning id`, [`nest-org-custom-${randomUUID()}`]))
      .rows[0]!.id;
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("organizations test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (vendorId !== undefined) {
      await pool.query(`delete from vendor_claims where vendor_id = $1`, [vendorId]);
      await pool.query(`delete from organizations where vendor_id = $1`, [vendorId]);
    }
    for (const id of [vendorCommunityId, machineCommunityId, customCommunityId]) {
      if (id !== undefined) await pool.query(`delete from communities where id = $1`, [id]);
    }
    if (machineId !== undefined) await pool.query(`delete from machines where id = $1`, [machineId]);
    if (vendorId !== undefined) await pool.query(`delete from vendors where id = $1`, [vendorId]);
    for (const id of [claimantId, staffId, nonStaffId]) {
      if (id !== undefined) await pool.query(`delete from users where id = $1`, [id]);
    }
    delete process.env.JWT_SECRET;
  });

  it("registers all six routes behind the versioned session-auth contract", async () => {
    for (const [method, path] of [
      ["POST", `/communities/${randomUUID()}/claim-owner`],
      ["POST", "/vendor-claims"],
      ["GET", "/vendor-claims/mine"],
      ["GET", "/vendor-claims"],
      ["POST", `/vendor-claims/${randomUUID()}/verify`],
      ["POST", `/vendor-claims/${randomUUID()}/revoke`],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      expect(response.status, `${method} ${path}`).toBe(401);
      const payload = (await response.json()) as { error?: { code?: unknown; requestId?: unknown } };
      expect(payload.error?.code).toBe("auth.unauthorized.v1");
      expect(typeof payload.error?.requestId).toBe("string");
    }
  });

  it("publishes all six routes and the versioned error envelope in OpenAPI", async () => {
    const document = (await (await fetch(`${baseUrl}/openapi.json`)).json()) as {
      paths?: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
    };
    for (const [method, path, success] of [
      ["post", "/communities/{id}/claim-owner", "200"],
      ["post", "/vendor-claims", "201"],
      ["get", "/vendor-claims/mine", "200"],
      ["get", "/vendor-claims", "200"],
      ["post", "/vendor-claims/{id}/verify", "200"],
      ["post", "/vendor-claims/{id}/revoke", "200"],
    ] as const) {
      const responses = document.paths?.[path]?.[method]?.responses;
      expect(responses, `${method.toUpperCase()} ${path}`).toHaveProperty(success);
      expect(responses?.["401"]?.content?.["application/json"]?.schema?.$ref).toContain("ApiErrorEnvelopeDto");
    }
  });

  it("preserves claim validation, staff gates, transactional lifecycle and owner revocation", async () => {
    const claimantCookie = await cookie(claimantId, "claimant");
    const staffCookie = await cookie(staffId, "staff");
    const nonStaffCookie = await cookie(nonStaffId, "non-staff");
    const jsonHeaders = { "content-type": "application/json" };

    const missingEvidence = await fetch(`${baseUrl}/vendor-claims`, {
      method: "POST",
      headers: { ...jsonHeaders, cookie: claimantCookie },
      body: JSON.stringify({ vendor_id: vendorId, organization_name: "Organization" }),
    });
    expect(missingEvidence.status).toBe(422);
    await expect(missingEvidence.json()).resolves.toMatchObject({ error: { code: "validation.invalid.v1" } });

    expect(
      (
        await fetch(`${baseUrl}/vendor-claims`, {
          headers: { cookie: nonStaffCookie },
        })
      ).status,
    ).toBe(403);

    const submitted = await fetch(`${baseUrl}/vendor-claims`, {
      method: "POST",
      headers: { ...jsonHeaders, cookie: claimantCookie },
      body: JSON.stringify({
        vendor_id: vendorId,
        organization_name: " Organization ",
        evidence_url: "https://example.test/proof",
      }),
    });
    expect(submitted.status).toBe(201);
    const claim = (await submitted.json()) as { id: string; organization_name: string; status: string };
    expect(claim).toMatchObject({ organization_name: "Organization", status: "pending" });

    expect(
      (
        await fetch(`${baseUrl}/vendor-claims`, {
          method: "POST",
          headers: { ...jsonHeaders, cookie: claimantCookie },
          body: JSON.stringify({
            vendor_id: vendorId,
            organization_name: "Organization",
            evidence_note: "duplicate",
          }),
        })
      ).status,
    ).toBe(409);
    await expect((await fetch(`${baseUrl}/vendor-claims/mine`, { headers: { cookie: claimantCookie } })).json()).resolves.toMatchObject({
      claims: [{ id: claim.id, status: "pending" }],
    });
    await expect((await fetch(`${baseUrl}/vendor-claims?status=pending`, { headers: { cookie: staffCookie } })).json()).resolves.toMatchObject({ claims: [{ id: claim.id }] });

    const verified = await fetch(`${baseUrl}/vendor-claims/${claim.id}/verify`, {
      method: "POST",
      headers: { ...jsonHeaders, cookie: staffCookie },
      body: JSON.stringify({ note: "verified" }),
    });
    expect(verified.status).toBe(200);
    const verifiedClaim = (await verified.json()) as { organization_id: string; status: string };
    expect(verifiedClaim.status).toBe("verified");
    expect(
      (
        await fetch(`${baseUrl}/vendor-claims/${claim.id}/verify`, {
          method: "POST",
          headers: { ...jsonHeaders, cookie: staffCookie },
          body: "{}",
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await fetch(`${baseUrl}/communities/${customCommunityId}/claim-owner`, {
          method: "POST",
          headers: { cookie: claimantCookie },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await fetch(`${baseUrl}/communities/${vendorCommunityId}/claim-owner`, {
          method: "POST",
          headers: { cookie: nonStaffCookie },
        })
      ).status,
    ).toBe(403);
    for (const communityId of [vendorCommunityId, machineCommunityId]) {
      const owner = await fetch(`${baseUrl}/communities/${communityId}/claim-owner`, {
        method: "POST",
        headers: { cookie: claimantCookie },
      });
      expect(owner.status).toBe(200);
      await expect(owner.json()).resolves.toMatchObject({ role: "owner", vendor_id: vendorId });
    }

    // Revoke follows the grant source, not the current role. A vendor-claim grant that was later
    // downgraded still disappears; a manual grant for the same vendor is preserved.
    await pool.query(`update community_members set role = 'moderator' where community_id = $1 and user_id = $2`, [vendorCommunityId, claimantId]);
    await pool.query(`update community_members set source = 'manual' where community_id = $1 and user_id = $2`, [machineCommunityId, claimantId]);

    expect(
      (
        await fetch(`${baseUrl}/vendor-claims/${claim.id}/revoke`, {
          method: "POST",
          headers: { ...jsonHeaders, cookie: staffCookie },
          body: "{}",
        })
      ).status,
    ).toBe(422);
    const revoked = await fetch(`${baseUrl}/vendor-claims/${claim.id}/revoke`, {
      method: "POST",
      headers: { ...jsonHeaders, cookie: staffCookie },
      body: JSON.stringify({ note: "revoked" }),
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({ status: "revoked" });

    const head = await pool.query(`select 1 from organization_members where organization_id = $1 and user_id = $2`, [verifiedClaim.organization_id, claimantId]);
    expect(head.rowCount).toBe(0);
    const revokedGrant = await pool.query(`select 1 from community_members where community_id = $1 and user_id = $2`, [vendorCommunityId, claimantId]);
    expect(revokedGrant.rowCount).toBe(0);
    const manualGrant = await pool.query<{ role: string; source: string }>(`select role, source from community_members where community_id = $1 and user_id = $2`, [
      machineCommunityId,
      claimantId,
    ]);
    expect(manualGrant.rows[0]).toEqual({ role: "owner", source: "manual" });
    const events = await pool.query<{ action: string }>(`select action from vendor_claim_events where claim_id = $1 order by created_at asc`, [claim.id]);
    expect(events.rows.map((row) => row.action)).toEqual(["submitted", "verified", "revoked"]);
  });
});
