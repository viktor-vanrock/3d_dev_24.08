import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { SanctionAppealId, SanctionId, UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { Sanction, SanctionAppeal, SanctionAppealState, SanctionReasonCode, SanctionState, SanctionType } from "../domain/sanctions.ts";
import type { SanctionsReadPort } from "../public/index.ts";

export interface SanctionRow {
  id: string; user_id: string; type: SanctionType; state: SanctionState; reason_code: SanctionReasonCode; reason_note: string | null; evidence_url: string | null;
  starts_at: Date; ends_at: Date | null; created_by: string; cancelled_at: Date | null; cancelled_by: string | null; cancel_reason: string | null;
  idempotency_key: string; idempotency_payload_hash: Buffer; created_at: Date; updated_at: Date;
}
export interface SanctionAppealRow {
  id: string; sanction_id: string; submitted_by: string; submitted_at: Date; message: string; state: SanctionAppealState; resolved_by: string | null;
  resolved_at: Date | null; resolution_note: string | null; created_at: Date; updated_at: Date;
}
const SANCTION_COLUMNS = `id, user_id, type, state, reason_code, reason_note, evidence_url, starts_at, ends_at,
  created_by, cancelled_at, cancelled_by, cancel_reason, idempotency_key, idempotency_payload_hash, created_at, updated_at`;
const APPEAL_COLUMNS = "id, sanction_id, submitted_by, submitted_at, message, state, resolved_by, resolved_at, resolution_note, created_at, updated_at";
function sanctionFromRow(row: SanctionRow): Sanction {
  return { id: SanctionId(row.id), userId: UserId(row.user_id), type: row.type, state: row.state, reasonCode: row.reason_code, reasonNote: row.reason_note,
    evidenceUrl: row.evidence_url, startsAt: new Date(row.starts_at), endsAt: row.ends_at === null ? null : new Date(row.ends_at), createdBy: UserId(row.created_by),
    cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at), cancelledBy: row.cancelled_by === null ? null : UserId(row.cancelled_by),
    cancelReason: row.cancel_reason, idempotencyKey: row.idempotency_key, idempotencyPayloadHash: row.idempotency_payload_hash, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) };
}
function appealFromRow(row: SanctionAppealRow): SanctionAppeal {
  return { id: SanctionAppealId(row.id), sanctionId: SanctionId(row.sanction_id), submittedBy: UserId(row.submitted_by), submittedAt: new Date(row.submitted_at),
    message: row.message, state: row.state, resolvedBy: row.resolved_by === null ? null : UserId(row.resolved_by), resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at),
    resolutionNote: row.resolution_note, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) };
}
/** Private SQL owner for sanctions and appeals. Lifecycle orchestration arrives in later PRs. */
@Injectable()
export class SanctionsRepository implements SanctionsReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  async findActiveForUser(userId: UserIdType): Promise<Sanction | null> {
    const result = await this.pool.query<SanctionRow>(`select ${SANCTION_COLUMNS} from sanctions where user_id = $1 and state = 'active'`, [userId]);
    const row = result.rows[0]; return row === undefined ? null : sanctionFromRow(row);
  }
  async listHistoryForUser(userId: UserIdType): Promise<readonly Sanction[]> {
    return (await this.pool.query<SanctionRow>(`select ${SANCTION_COLUMNS} from sanctions where user_id = $1 order by created_at desc, id desc`, [userId])).rows.map(sanctionFromRow);
  }
  async findByIdempotencyKey(tx: PoolClient, key: string): Promise<Sanction | null> {
    const row = (await tx.query<SanctionRow>(`select ${SANCTION_COLUMNS} from sanctions where idempotency_key = $1`, [key])).rows[0];
    return row === undefined ? null : sanctionFromRow(row);
  }

  async findById(tx: PoolClient, id: ReturnType<typeof SanctionId>): Promise<Sanction | null> {
    const row = (await tx.query<SanctionRow>(`select ${SANCTION_COLUMNS} from sanctions where id = $1`, [id])).rows[0];
    return row === undefined ? null : sanctionFromRow(row);
  }

  async findByIdForUpdate(tx: PoolClient, id: ReturnType<typeof SanctionId>): Promise<Sanction | null> {
    const row = (await tx.query<SanctionRow>(`select ${SANCTION_COLUMNS} from sanctions where id = $1 for update`, [id])).rows[0];
    return row === undefined ? null : sanctionFromRow(row);
  }

  async insertSanction(tx: PoolClient, input: Omit<Sanction, "id" | "createdAt" | "updatedAt">): Promise<Sanction>;
  async insertSanction(input: Omit<Sanction, "id" | "createdAt" | "updatedAt">): Promise<Sanction>;
  async insertSanction(
    txOrInput: PoolClient | Omit<Sanction, "id" | "createdAt" | "updatedAt">,
    maybeInput?: Omit<Sanction, "id" | "createdAt" | "updatedAt">,
  ): Promise<Sanction> {
    const tx = maybeInput === undefined ? this.pool : txOrInput as PoolClient;
    const input = maybeInput ?? txOrInput as Omit<Sanction, "id" | "createdAt" | "updatedAt">;
    const result = await tx.query<SanctionRow>(
      `insert into sanctions (user_id, type, state, reason_code, reason_note, evidence_url, starts_at, ends_at, created_by, cancelled_at, cancelled_by, cancel_reason, idempotency_key, idempotency_payload_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning ${SANCTION_COLUMNS}`,
      [input.userId, input.type, input.state, input.reasonCode, input.reasonNote, input.evidenceUrl, input.startsAt, input.endsAt, input.createdBy, input.cancelledAt, input.cancelledBy, input.cancelReason, input.idempotencyKey, input.idempotencyPayloadHash],
    );
    return sanctionFromRow(result.rows[0]!);
  }

  async cancelSanction(tx: PoolClient, id: ReturnType<typeof SanctionId>, input: { readonly actorId: UserIdType; readonly reason: string }): Promise<Sanction | null> {
    const row = (
      await tx.query<SanctionRow>(
        `update sanctions set state = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now()
         where id = $1 and state = 'active' returning ${SANCTION_COLUMNS}`,
        [id, input.actorId, input.reason],
      )
    ).rows[0];
    return row === undefined ? null : sanctionFromRow(row);
  }

  async findActiveByUserId(tx: PoolClient, userId: UserIdType): Promise<Sanction | null> {
    const row = (await tx.query<SanctionRow>(`select ${SANCTION_COLUMNS} from sanctions where user_id = $1 and state = 'active'`, [userId])).rows[0];
    return row === undefined ? null : sanctionFromRow(row);
  }

  async countOtherActiveByUser(tx: PoolClient, input: { readonly userId: UserIdType; readonly excludingId: ReturnType<typeof SanctionId> }): Promise<number> {
    const row = (
      await tx.query<{ count: string }>(`select count(*) as count from sanctions where user_id = $1 and state = 'active' and id <> $2`, [input.userId, input.excludingId])
    ).rows[0];
    return Number(row?.count ?? "0");
  }
  async claimDueActiveSanctionsForUpdate(tx: PoolClient, input: { readonly limit: number }): Promise<readonly { readonly id: ReturnType<typeof SanctionId>; readonly userId: UserIdType }[]> {
    return (
      await tx.query<{ id: string; user_id: string }>(
        `select id, user_id from sanctions where state = 'active' and ends_at is not null and ends_at < now()
         order by ends_at, id for update skip locked limit $1`,
        [input.limit],
      )
    ).rows.map((row) => ({ id: SanctionId(row.id), userId: UserId(row.user_id) }));
  }
  async markExpired(tx: PoolClient, input: { readonly id: ReturnType<typeof SanctionId> }): Promise<boolean> {
    return (await tx.query(`update sanctions set state = 'expired', updated_at = now() where id = $1 and state = 'active'`, [input.id])).rowCount === 1;
  }
  async countActiveSanctionsForUser(tx: PoolClient, input: { readonly userId: UserIdType }): Promise<number> {
    const row = (await tx.query<{ count: string }>(`select count(*) as count from sanctions where user_id = $1 and state = 'active'`, [input.userId])).rows[0];
    return Number(row?.count ?? "0");
  }
  async findAppealById(tx: PoolClient, id: ReturnType<typeof SanctionAppealId>): Promise<SanctionAppeal | null> {
    const row = (await tx.query<SanctionAppealRow>(`select ${APPEAL_COLUMNS} from sanction_appeals where id = $1`, [id])).rows[0];
    return row === undefined ? null : appealFromRow(row);
  }

  async findAppealsBySanction(tx: PoolClient, sanctionId: ReturnType<typeof SanctionId>, input: { readonly onlyForUserId?: UserIdType } = {}): Promise<readonly SanctionAppeal[]> {
    return (
      await tx.query<SanctionAppealRow>(
        `select ${APPEAL_COLUMNS} from sanction_appeals where sanction_id = $1 and ($2::uuid is null or submitted_by = $2) order by submitted_at desc, id desc`,
        [sanctionId, input.onlyForUserId ?? null],
      )
    ).rows.map(appealFromRow);
  }

  async insertAppeal(tx: PoolClient, input: { readonly sanctionId: ReturnType<typeof SanctionId>; readonly submitterId: UserIdType; readonly message: string }): Promise<SanctionAppeal>;
  async insertAppeal(input: Omit<SanctionAppeal, "id" | "submittedAt" | "createdAt" | "updatedAt"> & { readonly submittedAt?: Date }): Promise<SanctionAppeal>;
  async insertAppeal(
    txOrInput: PoolClient | (Omit<SanctionAppeal, "id" | "submittedAt" | "createdAt" | "updatedAt"> & { readonly submittedAt?: Date }),
    maybeInput?: { readonly sanctionId: ReturnType<typeof SanctionId>; readonly submitterId: UserIdType; readonly message: string },
  ): Promise<SanctionAppeal> {
    if (maybeInput !== undefined) {
      const result = await (txOrInput as PoolClient).query<SanctionAppealRow>(
        `insert into sanction_appeals (sanction_id, submitted_by, message) values ($1,$2,$3) returning ${APPEAL_COLUMNS}`,
        [maybeInput.sanctionId, maybeInput.submitterId, maybeInput.message],
      );
      return appealFromRow(result.rows[0]!);
    }
    const input = txOrInput as Omit<SanctionAppeal, "id" | "submittedAt" | "createdAt" | "updatedAt"> & { readonly submittedAt?: Date };
    const result = await this.pool.query<SanctionAppealRow>(
      `insert into sanction_appeals (sanction_id, submitted_by, submitted_at, message, state, resolved_by, resolved_at, resolution_note)
       values ($1,$2,coalesce($3,now()),$4,$5,$6,$7,$8) returning ${APPEAL_COLUMNS}`,
      [input.sanctionId, input.submittedBy, input.submittedAt ?? null, input.message, input.state, input.resolvedBy, input.resolvedAt, input.resolutionNote],
    );
    return appealFromRow(result.rows[0]!);
  }
  async listAppealsForSanction(sanctionId: ReturnType<typeof SanctionId>): Promise<readonly SanctionAppeal[]> {
    return (await this.pool.query<SanctionAppealRow>(`select ${APPEAL_COLUMNS} from sanction_appeals where sanction_id = $1 order by submitted_at desc, id desc`, [sanctionId])).rows.map(appealFromRow);
  }
  async resolveAppeal(tx: PoolClient, id: ReturnType<typeof SanctionAppealId>, input: { readonly resolverId: UserIdType; readonly state: "accepted" | "rejected"; readonly resolutionNote: string }): Promise<SanctionAppeal | null> {
    const row = (
      await tx.query<SanctionAppealRow>(
        `update sanction_appeals set state = $3, resolved_by = $2, resolved_at = now(), resolution_note = $4, updated_at = now()
         where id = $1 and state = 'pending' returning ${APPEAL_COLUMNS}`,
        [id, input.resolverId, input.state, input.resolutionNote],
      )
    ).rows[0];
    return row === undefined ? null : appealFromRow(row);
  }
}
