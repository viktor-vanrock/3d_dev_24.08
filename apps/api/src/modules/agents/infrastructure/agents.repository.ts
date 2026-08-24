import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
export interface AgentRow {
  readonly id: string;
  readonly owner_user_id: string;
  readonly name: string;
  readonly avatar_s3_key: string | null;
  readonly bio: string | null;
  readonly runtime_label: string | null;
  readonly status: string;
  readonly created_at: Date;
  readonly revoked_at: Date | null;
}
const COLUMNS = "id,owner_user_id,name,avatar_s3_key,bio,runtime_label,status,created_at,revoked_at";
export async function isActiveContentAgent(db: Pool | PoolClient, id: string, ownerId: string): Promise<boolean> {
  return (await db.query(`select 1 from content_agents where id=$1 and owner_user_id=$2 and status='active'`, [id, ownerId])).rowCount !== 0;
}
@Injectable()
export class AgentsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  async create(ownerId: UserId, input: { name: string; bio: string | null; runtimeLabel: string | null }) {
    const r = await this.pool.query<AgentRow>(`insert into content_agents(owner_user_id,name,bio,runtime_label)values($1,$2,$3,$4)returning ${COLUMNS}`, [
      ownerId,
      input.name,
      input.bio,
      input.runtimeLabel,
    ]);
    return r.rows[0]!;
  }
  async list(ownerId: UserId, limit: number, offset: number) {
    return (
      await this.pool.query<AgentRow>(`select ${COLUMNS} from content_agents where owner_user_id=$1 order by created_at desc,id desc limit $2 offset $3`, [ownerId, limit, offset])
    ).rows;
  }
  async revoke(ownerId: UserId, id: string) {
    const r = await this.pool.query<AgentRow>(
      `update content_agents set status='revoked',revoked_at=now() where id=$1 and owner_user_id=$2 and status='active' returning ${COLUMNS}`,
      [id, ownerId],
    );
    return r.rows[0] ?? null;
  }
  async isActiveOwner(ownerId: UserId, id: string) {
    return (await this.pool.query(`select id from content_agents where id=$1 and owner_user_id=$2 and status='active'`, [id, ownerId])).rowCount !== 0;
  }
}
