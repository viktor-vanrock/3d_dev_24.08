import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { ImportBindingSummary, ImportConnectionRow, StoredImportConnectionCredential } from "../domain/import-connections.ts";

@Injectable()
export class ImportConnectionsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async exists(input: { readonly connectionId: string; readonly userId: UserId; readonly sourcePlatform: string }): Promise<boolean> {
    const result = await this.pool.query(`select id from import_connections where id = $1 and user_id = $2 and source_platform = $3`, [
      input.connectionId,
      input.userId,
      input.sourcePlatform,
    ]);
    return result.rows[0] !== undefined;
  }

  async upsertCults3d(userId: UserId, username: string, credential: Buffer): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `insert into import_connections (user_id, source_platform, credential_enc, external_username, status, last_error, last_synced_at)
       values ($1, 'cults3d', $2, $3, 'active', null, now())
       on conflict (user_id, source_platform) do update set
         credential_enc = excluded.credential_enc, external_username = excluded.external_username,
         status = 'active', last_error = null, last_synced_at = now(), updated_at = now()
       returning id`,
      [userId, credential, username || null],
    );
    return result.rows[0]!.id;
  }

  markVerified(connectionId: string): Promise<void> {
    return this.setOwnershipStatus(connectionId, "verified");
  }

  async list(userId: UserId): Promise<{ readonly connections: readonly ImportConnectionRow[]; readonly bindings: readonly ImportBindingSummary[] }> {
    const connections = await this.pool.query<ImportConnectionRow>(
      `select id, source_platform, external_username, ownership_status, challenge_token, challenge_target,
              status, last_error, last_synced_at, created_at
       from import_connections where user_id = $1 order by created_at desc`,
      [userId],
    );
    const bindings = await this.pool.query<ImportBindingSummary>(
      `select ib.id, m.project_id as model_id, ib.source_platform, ib.external_id, ib.ownership_status, ib.imported_at
       from import_bindings ib join models m on m.id = ib.model_id
       where ib.user_id = $1 order by ib.imported_at desc`,
      [userId],
    );
    return { connections: connections.rows, bindings: bindings.rows };
  }

  async findCults3dCredential(userId: UserId, connectionId: string): Promise<StoredImportConnectionCredential | null> {
    const result = await this.pool.query<StoredImportConnectionCredential>(
      `select credential_enc, external_username from import_connections
       where id = $1 and user_id = $2 and source_platform = 'cults3d'`,
      [connectionId, userId],
    );
    return result.rows[0] ?? null;
  }

  async setChallenge(userId: UserId, connectionId: string, token: string, target: string): Promise<boolean> {
    const result = await this.pool.query(
      `update import_connections set
         challenge_token = $3, challenge_target = $4, ownership_status = 'pending', updated_at = now()
       where id = $1 and user_id = $2`,
      [connectionId, userId, token, target],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findChallenge(userId: UserId, connectionId: string): Promise<{ readonly challenge_token: string | null } | null> {
    const result = await this.pool.query<{ challenge_token: string | null }>(`select challenge_token from import_connections where id = $1 and user_id = $2`, [
      connectionId,
      userId,
    ]);
    return result.rows[0] ?? null;
  }

  setOwnershipStatus(connectionId: string, status: "verified" | "rejected"): Promise<void> {
    return this.transaction(async (client) => {
      await client.query(
        `update import_connections set
           ownership_status = $2,
           verified_at = case when $2 = 'verified' then now() else verified_at end,
           challenge_token = null,
           challenge_target = null,
           updated_at = now()
         where id = $1`,
        [connectionId, status],
      );
      await client.query(`update import_bindings set ownership_status = $2, updated_at = now() where connection_id = $1`, [connectionId, status]);
    });
  }

  private async transaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await work(client);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
