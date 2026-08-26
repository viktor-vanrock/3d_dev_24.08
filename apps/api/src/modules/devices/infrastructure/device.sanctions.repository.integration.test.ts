import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { DevicesRepository } from "./devices.repository.ts";

const userIds: string[] = [];
const agentIds: string[] = [];
const codeIds: string[] = [];

async function createUser(): Promise<ReturnType<typeof UserId>> {
  const result = await pool.query<{ id: string }>(`insert into users(username) values($1) returning id`, [`device-sanctions-${randomUUID()}`]);
  const id = UserId(result.rows[0]!.id);
  userIds.push(id);
  return id;
}

async function createAgent(ownerId: string, revokedAt: Date | null = null): Promise<string> {
  const result = await pool.query<{ id: string }>(`insert into agents(owner_id, revoked_at, revoked_reason) values($1,$2,$3) returning id`, [ownerId, revokedAt, revokedAt === null ? null : "prior"]);
  const id = result.rows[0]!.id;
  agentIds.push(id);
  return id;
}

async function createCode(ownerId: string, values: { usedAt?: Date | null; revokedAt?: Date | null; expiresAt?: Date } = {}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into device_enroll_codes(owner_id, code_hash, expires_at, used_at, revoked_at)
     values($1,$2,$3,$4,$5) returning id`,
    [ownerId, Buffer.from(randomUUID()), values.expiresAt ?? new Date(Date.now() + 60_000), values.usedAt ?? null, values.revokedAt ?? null],
  );
  const id = result.rows[0]!.id;
  codeIds.push(id);
  return id;
}

function repository(): DevicesRepository {
  return new DevicesRepository(pool, {} as never);
}

afterAll(async () => {
  if (codeIds.length > 0) await pool.query(`delete from device_enrollment_audit where credential_id = any($1::uuid[])`, [codeIds]);
  if (codeIds.length > 0) await pool.query(`delete from device_enroll_codes where id = any($1::uuid[])`, [codeIds]);
  if (agentIds.length > 0) await pool.query(`delete from agents where id = any($1::uuid[])`, [agentIds]);
  if (userIds.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [userIds]);
});

describe("DeviceSanctionsPort", () => {
  it("revokes only active agents and only pending enrollment codes with an audit row per code", async () => {
    const ownerId = await createUser();
    const actorId = await createUser();
    const activeOne = await createAgent(ownerId);
    const activeTwo = await createAgent(ownerId);
    const alreadyRevokedAt = new Date("2020-01-01T00:00:00.000Z");
    const alreadyRevoked = await createAgent(ownerId, alreadyRevokedAt);
    const pending = await createCode(ownerId);
    const used = await createCode(ownerId, { usedAt: new Date() });
    const revoked = await createCode(ownerId, { revokedAt: new Date("2020-01-01T00:00:00.000Z") });
    const expired = await createCode(ownerId, { expiresAt: new Date(Date.now() - 60_000) });
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      const result = await repository().revokeCredentialsForSanction(tx, { ownerId, actorId });
      expect(result).toEqual({ agentIds: expect.arrayContaining([activeOne, activeTwo]), agentsRevoked: 2, enrollCodesRevoked: 1 });
      expect(result.agentIds).toHaveLength(2);
      await tx.query("commit");
    } finally {
      tx.release();
    }
    await expect(pool.query(`select revoked_at, revoked_reason from agents where id=$1`, [alreadyRevoked])).resolves.toMatchObject({ rows: [{ revoked_at: alreadyRevokedAt, revoked_reason: "prior" }] });
    const codes = await pool.query<{ id: string; revoked_at: Date | null }>(`select id, revoked_at from device_enroll_codes where id = any($1::uuid[])`, [[pending, used, revoked, expired]]);
    expect(codes.rows.filter((row) => row.revoked_at !== null).map((row) => row.id).sort()).toEqual([pending, revoked].sort());
    await expect(pool.query<{ event_type: string; meta: Record<string, unknown> }>(`select event_type, meta from device_enrollment_audit where credential_id=$1`, [pending])).resolves.toMatchObject({
      rows: [{ event_type: "credential.revoked", meta: { reason: "owner_sanctioned", actor_id: actorId } }],
    });
  });

  it("is idempotent and creates no extra audit rows", async () => {
    const ownerId = await createUser();
    const actorId = await createUser();
    const pending = await createCode(ownerId);
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      await repository().revokeCredentialsForSanction(tx, { ownerId, actorId });
      await tx.query("commit");
      await tx.query("begin");
      await expect(repository().revokeCredentialsForSanction(tx, { ownerId, actorId })).resolves.toEqual({ agentIds: [], agentsRevoked: 0, enrollCodesRevoked: 0 });
      await tx.query("commit");
    } finally {
      tx.release();
    }
    await expect(pool.query(`select 1 from device_enrollment_audit where credential_id=$1`, [pending])).resolves.toMatchObject({ rowCount: 1 });
  });

  it("rolls back agents, codes and audit rows with the caller transaction", async () => {
    const ownerId = await createUser();
    const actorId = await createUser();
    const agent = await createAgent(ownerId);
    const code = await createCode(ownerId);
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      await repository().revokeCredentialsForSanction(tx, { ownerId, actorId });
      await tx.query("rollback");
    } finally {
      tx.release();
    }
    await expect(pool.query(`select revoked_at from agents where id=$1`, [agent])).resolves.toMatchObject({ rows: [{ revoked_at: null }] });
    await expect(pool.query(`select revoked_at from device_enroll_codes where id=$1`, [code])).resolves.toMatchObject({ rows: [{ revoked_at: null }] });
    await expect(pool.query(`select 1 from device_enrollment_audit where credential_id=$1`, [code])).resolves.toMatchObject({ rowCount: 0 });
  });

  it("returns zero counts for an owner without credentials", async () => {
    const ownerId = await createUser();
    const actorId = await createUser();
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      await expect(repository().revokeCredentialsForSanction(tx, { ownerId, actorId })).resolves.toEqual({ agentIds: [], agentsRevoked: 0, enrollCodesRevoked: 0 });
      await tx.query("commit");
    } finally {
      tx.release();
    }
  });
});
