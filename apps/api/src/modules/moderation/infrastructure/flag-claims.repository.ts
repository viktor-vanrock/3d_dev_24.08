import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { FlagClaim } from "../domain/moderation.entities.ts";
import type { FlagClaimsPort } from "../domain/moderation.ports.ts";

type FlagClaimRow = { id: string; flag_id: string; moderator_id: string; claimed_at: string | Date; expires_at: string | Date; released_at: string | Date | null; release_reason: string | null; state: FlagClaim["state"] };
function map(row: FlagClaimRow): FlagClaim { return { id: row.id, flagId: row.flag_id, moderatorId: UserId(row.moderator_id), claimedAt: new Date(row.claimed_at), expiresAt: new Date(row.expires_at), releasedAt: row.released_at ? new Date(row.released_at) : null, releaseReason: row.release_reason, state: row.state }; }

@Injectable() export class FlagClaimsRepository implements FlagClaimsPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  async expireActiveForFlag(tx: PoolClient, id: string, now: Date): Promise<void> { await tx.query(`update flag_claims set state='expired',released_at=now(),release_reason='claim_expired' where flag_id=$1 and state='active' and expires_at<=$2`, [id, now]); }
  async findActiveForFlagForUpdate(tx: PoolClient, id: string): Promise<FlagClaim | null> { const row = (await tx.query<FlagClaimRow>(`select * from flag_claims where flag_id=$1 and state='active' for update`, [id])).rows[0]; return row ? map(row) : null; }
  async create(tx: PoolClient, input: Parameters<FlagClaimsPort["create"]>[1]): Promise<FlagClaim> { const row = (await tx.query<FlagClaimRow>(`insert into flag_claims(flag_id,moderator_id,expires_at) values($1,$2,$3) returning *`, [input.flagId, input.moderatorId, input.expiresAt])).rows[0]; if (!row) throw new Error("flag claim insert failed"); return map(row); }
  async release(tx: PoolClient, input: Parameters<FlagClaimsPort["release"]>[1]): Promise<boolean> { return (await tx.query(`update flag_claims set state='released',released_at=now(),release_reason=$3 where id=$1 and moderator_id=$2 and state='active'`, [input.claimId, input.actorId, input.reason])).rowCount === 1; }
}
