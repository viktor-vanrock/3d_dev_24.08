import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import type { PublicApiKeyScope } from "../public/index.ts";

export interface ApiKeyRow {
  readonly id: string;
  readonly name: string;
  readonly key_prefix: string;
  readonly scopes: PublicApiKeyScope[];
  readonly revoked_at: Date | null;
  readonly last_used_at: Date | null;
  readonly created_at: Date;
  readonly expires_at?: Date | null;
}
export interface UserApiKeyRow {
  readonly id: string;
  readonly label: string | null;
  readonly key_prefix: string;
  readonly scope: string;
  readonly status: string;
  readonly last_used_at: Date | null;
  readonly created_at: Date;
  readonly revoked_at: Date | null;
}
export type ApiKeyVerification =
  | { readonly kind: "active"; readonly row: { id: string; owner_id: string; scopes: PublicApiKeyScope[] } }
  | { readonly kind: "revoked" | "unknown" | "user_blocked" };

@Injectable()
export class PublicApiRepository {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
  ) {}

  async activeApiKeyCount(ownerId: UserId): Promise<number> {
    const r = await this.pool.query<{ count: string }>(
      `select count(*) as count from api_keys where owner_id=$1 and revoked_at is null and (expires_at is null or expires_at>now())`,
      [ownerId],
    );
    return Number(r.rows[0]?.count ?? "0");
  }
  async insertApiKey(ownerId: UserId, input: { name: string; prefix: string; hash: Buffer; scopes: readonly PublicApiKeyScope[] }): Promise<ApiKeyRow> {
    const r = await this.pool.query<ApiKeyRow>(
      `insert into api_keys(owner_id,name,key_prefix,key_hash,scopes) values($1,$2,$3,$4,$5) returning id,name,key_prefix,scopes,revoked_at,last_used_at,created_at`,
      [ownerId, input.name, input.prefix, input.hash, input.scopes],
    );
    return r.rows[0]!;
  }
  async listApiKeys(ownerId: UserId): Promise<readonly ApiKeyRow[]> {
    return (
      await this.pool.query<ApiKeyRow>(`select id,name,key_prefix,scopes,revoked_at,last_used_at,created_at from api_keys where owner_id=$1 order by created_at desc`, [ownerId])
    ).rows;
  }
  async revokeApiKey(ownerId: UserId, id: string): Promise<boolean> {
    return (await this.pool.query(`update api_keys set revoked_at=now() where id=$1 and owner_id=$2 and revoked_at is null`, [id, ownerId])).rowCount !== 0;
  }
  async hasApiKey(ownerId: UserId, id: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from api_keys where id=$1 and owner_id=$2`, [id, ownerId])).rowCount !== 0;
  }
  async rotateApiKey(ownerId: UserId, id: string, input: { name?: string; prefix: string; hash: Buffer }): Promise<ApiKeyRow | "not_found" | "already_revoked"> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      const existing = await c.query<{ name: string; revoked_at: Date | null }>(`select name,revoked_at from api_keys where id=$1 and owner_id=$2 for update`, [id, ownerId]);
      const old = existing.rows[0];
      if (!old) {
        await c.query("rollback");
        return "not_found";
      }
      if (old.revoked_at) {
        await c.query("rollback");
        return "already_revoked";
      }
      const name = input.name?.trim().slice(0, 128) || old.name;
      const inserted = await c.query<ApiKeyRow>(
        `insert into api_keys(owner_id,name,key_prefix,key_hash,scopes) select owner_id,$3,$4,$5,scopes from api_keys where id=$1 and owner_id=$2 returning id,name,key_prefix,scopes,revoked_at,last_used_at,created_at`,
        [id, ownerId, name, input.prefix, input.hash],
      );
      await c.query(`update api_keys set revoked_at=now() where id=$1`, [id]);
      await c.query("commit");
      return inserted.rows[0]!;
    } catch (error) {
      await c.query("rollback").catch(() => {});
      throw error;
    } finally {
      c.release();
    }
  }
  async verifyApiKey(hash: Buffer): Promise<ApiKeyVerification> {
    const r = await this.pool.query<{ id: string; owner_id: string; scopes: PublicApiKeyScope[]; revoked_at: Date | null; expires_at: Date | null }>(
      `select id,owner_id,scopes,revoked_at,expires_at from api_keys where key_hash=$1`,
      [hash],
    );
    const row = r.rows[0];
    if (row === undefined) return { kind: "revoked" };
    if (row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= new Date())) return { kind: "revoked" };
    const owner = await this.profiles.loadOwnerAuthState(row.owner_id as UserId);
    if (owner === null) return { kind: "unknown" };
    if (owner.status !== "active") return { kind: "user_blocked" };
    void this.pool.query(`update api_keys set last_used_at=now() where id=$1`, [row.id]).catch(() => {});
    return { kind: "active", row };
  }

  async insertUserApiKey(input: {
    ownerId: UserId;
    agentId?: string;
    scope: string;
    scopes?: readonly string[];
    label: string;
    prefix: string;
    hash: Buffer;
  }): Promise<UserApiKeyRow> {
    const r = await this.pool.query<UserApiKeyRow>(
      `insert into user_api_keys(user_id,agent_id,scope,scopes,label,key_prefix,key_hash) values($1,$2,$3,$4,$5,$6,$7) returning id,label,key_prefix,scope,status,last_used_at,created_at,revoked_at`,
      [input.ownerId, input.agentId ?? null, input.scope, input.scopes ?? ["read"], input.label, input.prefix, input.hash],
    );
    return r.rows[0]!;
  }
  async listUserApiKeys(ownerId: UserId, scope: string, limit: number, offset: number): Promise<readonly UserApiKeyRow[]> {
    return (
      await this.pool.query<UserApiKeyRow>(
        `select id,label,key_prefix,scope,status,last_used_at,created_at,revoked_at from user_api_keys where user_id=$1 and scope=$2 order by created_at desc,id desc limit $3 offset $4`,
        [ownerId, scope, limit, offset],
      )
    ).rows;
  }
  async revokeUserApiKey(ownerId: UserId, id: string, scope: string): Promise<boolean> {
    return (
      (await this.pool.query(`update user_api_keys set status='revoked',revoked_at=now() where id=$1 and user_id=$2 and scope=$3 and status='active'`, [id, ownerId, scope]))
        .rowCount !== 0
    );
  }
  async hasUserApiKey(ownerId: UserId, id: string, scope: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from user_api_keys where id=$1 and user_id=$2 and scope=$3`, [id, ownerId, scope])).rowCount !== 0;
  }
  async listAgentKeys(ownerId: UserId, agentId: string): Promise<readonly UserApiKeyRow[]> {
    return (
      await this.pool.query<UserApiKeyRow>(
        `select id,label,key_prefix,scope,status,last_used_at,created_at,revoked_at from user_api_keys where user_id=$1 and agent_id=$2 and scope='agent_content' order by created_at desc`,
        [ownerId, agentId],
      )
    ).rows;
  }
  async revokeAgentKey(ownerId: UserId, agentId: string, keyId: string): Promise<boolean> {
    return (
      (
        await this.pool.query(
          `update user_api_keys set status='revoked',revoked_at=now() where id=$1 and user_id=$2 and agent_id=$3 and scope='agent_content' and status='active'`,
          [keyId, ownerId, agentId],
        )
      ).rowCount !== 0
    );
  }
  async hasAgentKey(ownerId: UserId, agentId: string, keyId: string): Promise<boolean> {
    return (
      await this.pool.query(`select 1 from user_api_keys where id=$1 and user_id=$2 and agent_id=$3 and scope='agent_content'`, [keyId, ownerId, agentId])
    ).rowCount !== 0;
  }
  async revokeAllAgentKeys(agentId: string): Promise<number> {
    const result = await this.pool.query(`update user_api_keys set status='revoked',revoked_at=now(),revoked_reason='agent_revoked' where agent_id=$1 and status='active'`, [agentId]);
    return result.rowCount ?? 0;
  }
}
