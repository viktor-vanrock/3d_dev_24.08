import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PrintersRepository } from "../../printers/infrastructure/printers.repository.ts";
import type { DeviceExternalPort } from "../public/index.ts";
import { DevicesRepository } from "./devices.repository.ts";

const canRun = Boolean(process.env.DATABASE_URL);
const printers = new PrintersRepository(pool);
const repository = new DevicesRepository(pool, printers);
const commandVerification = {
  version: "device-agent-runtime.v1" as const,
  issuer: "portal-api",
  audience: "portal-device-agent",
  keys: [{ kid: "current", alg: "EdDSA" as const, kty: "OKP" as const, crv: "Ed25519" as const, x: "A".repeat(43) }],
};
const external = {
  issueAgentCredential: async () => {
    throw new Error("legacy credential issuance must not run during CSR enrollment");
  },
  issueGatewayCertificate: (_csr: string, gatewayId: string) => ({
    certificatePem: "-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----",
    certificateChainPem: ["-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----"],
    caBundlePem: ["-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----"],
    fingerprintSha256: createHash("sha256").update(gatewayId).digest("hex"),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    commandVerification,
  }),
} satisfies Pick<DeviceExternalPort, "issueAgentCredential" | "issueGatewayCertificate">;

let ownerId: ReturnType<typeof UserId>;

describe.skipIf(!canRun)("device enrollment and recovery transaction", () => {
  beforeEach(async () => {
    ownerId = UserId(randomUUID());
    await pool.query(`insert into users(id,username) values($1,$2)`, [ownerId, `agent-enroll-${randomUUID()}`]);
  });

  afterEach(async () => {
    await pool.query(`delete from users where id=$1`, [ownerId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("atomically consumes hashed credentials, rotates fingerprint, and audits no raw credential", async () => {
    const enrollment = await repository.createEnrollCode(ownerId, { firmwareClass: "klipper", label: "Test", deviceId: null });
    const stored = await pool.query<{ code_hash: Buffer; credential_kind: string }>(`select code_hash,credential_kind from device_enroll_codes where id=$1`, [enrollment.id]);
    expect(stored.rows[0]?.credential_kind).toBe("enrollment");
    expect(stored.rows[0]?.code_hash.equals(Buffer.from(enrollment.code))).toBe(false);

    const first = await repository.redeemEnrollCode(enrollment.code, "1.2.3", "request-1", external, "-----BEGIN CERTIFICATE REQUEST-----\ncsr\n-----END CERTIFICATE REQUEST-----", "enrollment");
    await expect(repository.redeemEnrollCode(enrollment.code, "1.2.3", "request-replay", external, "-----BEGIN CERTIFICATE REQUEST-----\ncsr\n-----END CERTIFICATE REQUEST-----", "enrollment"))
      .rejects.toThrow("invalid_or_expired_code");

    const recovery = await repository.createEnrollCode(ownerId, { firmwareClass: "klipper", label: "Test", deviceId: first.deviceId });
    const rotated = await repository.redeemEnrollCode(recovery.code, "1.2.4", "request-2", external, "-----BEGIN CERTIFICATE REQUEST-----\ncsr-2\n-----END CERTIFICATE REQUEST-----", "recovery");
    expect(rotated.deviceId).toBe(first.deviceId);
    expect(rotated.agentId).not.toBe(first.agentId);

    const agents = await pool.query<{ id: string; revoked_at: Date | null; relay_certificate_fingerprint_sha256: string | null }>(
      `select id,revoked_at,relay_certificate_fingerprint_sha256 from agents where id=any($1::uuid[]) order by id`,
      [[first.agentId, rotated.agentId]],
    );
    expect(agents.rows.find((row) => row.id === first.agentId)?.revoked_at).not.toBeNull();
    expect(agents.rows.find((row) => row.id === rotated.agentId)?.relay_certificate_fingerprint_sha256).toBe(createHash("sha256").update(rotated.agentId).digest("hex"));

    const audit = await pool.query<{ event_type: string; meta: unknown }>(`select event_type,meta from device_enrollment_audit where owner_id=$1 order by created_at`, [ownerId]);
    expect(audit.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["credential.created", "credential.consumed", "identity.issued"]));
    expect(JSON.stringify(audit.rows)).not.toContain(enrollment.code);
    expect(JSON.stringify(audit.rows)).not.toContain(recovery.code);

    await pool.query(`delete from device_enroll_codes where id=$1`, [enrollment.id]);
    const retained = await pool.query<{ credential_id: string | null }>(
      `select credential_id from device_enrollment_audit where owner_id=$1 and event_type='credential.consumed' order by created_at limit 1`,
      [ownerId],
    );
    expect(retained.rows[0]?.credential_id).toBeNull();
  });
});
