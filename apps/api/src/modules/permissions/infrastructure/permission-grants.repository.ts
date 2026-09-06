import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionGrantsRepository } from "../application/permissions.service.ts";
import type { PermissionGrant, PermissionScope } from "../domain/permission-grant.ts";
import type { Permissions } from "../domain/permissions.catalog.ts";

interface PermissionGrantRow {
  id: string;
  user_id: string;
  permission: Permissions;
  scope: PermissionScope;
  granted_by: string;
  reason: string;
  granted_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

function permissionGrant(row: PermissionGrantRow): PermissionGrant {
  return {
    id: row.id,
    userId: UserId(row.user_id),
    permission: row.permission,
    scope: row.scope,
    grantedBy: UserId(row.granted_by),
    reason: row.reason,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by === null ? null : UserId(row.revoked_by),
    revokeReason: row.revoke_reason,
  };
}

@Injectable()
export class PermissionGrantsPgRepository implements PermissionGrantsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async isUserActive(userId: UserId): Promise<boolean> {
    const result = await this.pool.query(`select 1 from identity_read_v1 where user_id = $1`, [userId]);
    return result.rowCount === 1;
  }

  async findActiveGrants(input: { readonly userId: UserId; readonly permission: Permissions; readonly now: Date }): Promise<readonly PermissionGrant[]> {
    const result = await this.pool.query<PermissionGrantRow>(
      `select id,user_id,permission,scope,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason
       from permission_grants
       where user_id=$1 and permission=$2 and revoked_at is null and (expires_at is null or expires_at>$3)`,
      [input.userId, input.permission, input.now],
    );
    return result.rows.map(permissionGrant);
  }

  async createWithAudit(input: {
    readonly userId: UserId;
    readonly permission: Permissions;
    readonly scope: PermissionScope;
    readonly grantedBy: UserId;
    readonly reason: string;
    readonly expiresAt: Date | null;
  }): Promise<PermissionGrant> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const created = await client.query<PermissionGrantRow>(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason,expires_at)
         values($1,$2,$3,$4,$5,$6)
         returning id,user_id,permission,scope,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason`,
        [input.userId, input.permission, JSON.stringify(input.scope), input.grantedBy, input.reason, input.expiresAt],
      );
      const row = created.rows[0];
      if (row === undefined) throw new Error("Не удалось создать grant разрешения");
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,$3,$4,$5,$6,now())`,
        [randomUUID(), input.grantedBy, "permission.granted", "permission_grant", row.id, JSON.stringify({ user_id: input.userId, permission: input.permission, reason: input.reason })],
      );
      await client.query("commit");
      return permissionGrant(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeWithAudit(input: { readonly grantId: string; readonly revokedBy: UserId; readonly reason: string }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const updated = await client.query<{ id: string; user_id: string; permission: Permissions }>(
        `update permission_grants set revoked_at=now(),revoked_by=$2,revoke_reason=$3
         where id=$1 and revoked_at is null returning id,user_id,permission`,
        [input.grantId, input.revokedBy, input.reason],
      );
      const row = updated.rows[0];
      if (row === undefined) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        `insert into audit_log(id,actor_user_id,action,target_type,target_id,details,created_at)
         values($1,$2,$3,$4,$5,$6,now())`,
        [randomUUID(), input.revokedBy, "permission.revoked", "permission_grant", row.id, JSON.stringify({ user_id: row.user_id, permission: row.permission, reason: input.reason })],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
