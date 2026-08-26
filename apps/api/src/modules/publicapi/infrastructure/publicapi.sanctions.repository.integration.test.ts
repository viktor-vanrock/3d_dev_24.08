import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PublicApiRepository } from "./publicapi.repository.ts";

const userIds: string[] = [];
const apiKeyIds: string[] = [];
const userApiKeyIds: string[] = [];
async function createUser(): Promise<ReturnType<typeof UserId>> {
  const result = await pool.query<{ id: string }>(`insert into users(username) values($1) returning id`, [`publicapi-sanctions-${randomUUID()}`]);
  const id = UserId(result.rows[0]!.id); userIds.push(id); return id;
}
async function apiKey(ownerId: string, revokedAt: Date | null = null): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into api_keys(owner_id,name,key_prefix,key_hash,created_at,revoked_at)
     values($1,'fixture',$2,$3,case when $4::timestamptz is null then now() else $4 - interval '1 day' end,$4) returning id`,
    [ownerId, `pk_${randomUUID()}`, Buffer.from(randomUUID()), revokedAt],
  );
  const id = result.rows[0]!.id; apiKeyIds.push(id); return id;
}
async function userApiKey(ownerId: string, status: "active" | "revoked" = "active", revokedReason: string | null = null): Promise<string> {
  const revokedAt = status === "revoked" ? new Date("2020-01-01T00:00:00.000Z") : null;
  const result = await pool.query<{ id: string }>(
    `insert into user_api_keys(user_id,scope,scopes,label,key_prefix,key_hash,status,created_at,updated_at,revoked_at,revoked_reason)
     values($1,'public_api',array['read'],'fixture',$2,$3,$4,case when $5::timestamptz is null then now() else $5 - interval '1 day' end,now(),$5,$6) returning id`,
    [ownerId, `uk_${randomUUID()}`, Buffer.from(randomUUID()), status, revokedAt, revokedReason],
  );
  const id = result.rows[0]!.id; userApiKeyIds.push(id); return id;
}
function repository(): PublicApiRepository { return new PublicApiRepository(pool, {} as never); }
afterAll(async () => {
  if (apiKeyIds.length > 0) await pool.query(`delete from api_keys where id = any($1::uuid[])`, [apiKeyIds]);
  if (userApiKeyIds.length > 0) await pool.query(`delete from user_api_keys where id = any($1::uuid[])`, [userApiKeyIds]);
  if (userIds.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [userIds]);
});

describe("PublicApiSanctionsPort", () => {
  it("revokes only active credential rows and preserves prior revocations", async () => {
    const ownerId = await createUser();
    await apiKey(ownerId); await apiKey(ownerId); const priorApi = await apiKey(ownerId, new Date("2020-01-01T00:00:00.000Z"));
    await userApiKey(ownerId); await userApiKey(ownerId); const priorUser = await userApiKey(ownerId, "revoked", "prior");
    const tx = await pool.connect();
    try { await tx.query("begin"); await expect(repository().revokeCredentialsForSanction(tx, { ownerId })).resolves.toEqual({ apiKeysRevoked: 2, userApiKeysRevoked: 2 }); await tx.query("commit"); } finally { tx.release(); }
    await expect(pool.query(`select revoked_at from api_keys where id=$1`, [priorApi])).resolves.toMatchObject({ rows: [{ revoked_at: new Date("2020-01-01T00:00:00.000Z") }] });
    await expect(pool.query(`select status, revoked_reason from user_api_keys where id=$1`, [priorUser])).resolves.toMatchObject({ rows: [{ status: "revoked", revoked_reason: "prior" }] });
    await expect(pool.query(`select status, revoked_reason, revoked_at from user_api_keys where user_id=$1 and status='revoked' and revoked_reason='owner_sanctioned'`, [ownerId])).resolves.toMatchObject({ rowCount: 2 });
  });

  it("is idempotent and returns zero for an owner without keys", async () => {
    const ownerId = await createUser(); const keyOwner = await createUser(); await apiKey(keyOwner); await userApiKey(keyOwner); const tx = await pool.connect();
    try {
      await tx.query("begin"); await expect(repository().revokeCredentialsForSanction(tx, { ownerId })).resolves.toEqual({ apiKeysRevoked: 0, userApiKeysRevoked: 0 }); await tx.query("commit");
      await tx.query("begin"); await repository().revokeCredentialsForSanction(tx, { ownerId: keyOwner }); await tx.query("commit");
      await tx.query("begin"); await expect(repository().revokeCredentialsForSanction(tx, { ownerId: keyOwner })).resolves.toEqual({ apiKeysRevoked: 0, userApiKeysRevoked: 0 }); await tx.query("commit");
    } finally { tx.release(); }
  });

  it("rolls back both credential classes with the external transaction", async () => {
    const ownerId = await createUser(); const publicKey = await apiKey(ownerId); const userKey = await userApiKey(ownerId); const tx = await pool.connect();
    try { await tx.query("begin"); await repository().revokeCredentialsForSanction(tx, { ownerId }); await tx.query("rollback"); } finally { tx.release(); }
    await expect(pool.query(`select revoked_at from api_keys where id=$1`, [publicKey])).resolves.toMatchObject({ rows: [{ revoked_at: null }] });
    await expect(pool.query(`select status, revoked_at, revoked_reason from user_api_keys where id=$1`, [userKey])).resolves.toMatchObject({ rows: [{ status: "active", revoked_at: null, revoked_reason: null }] });
  });
});
