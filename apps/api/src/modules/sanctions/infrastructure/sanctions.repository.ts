import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { SanctionAppealId, SanctionId, UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { Sanction, SanctionAppeal, SanctionAppealState, SanctionReasonCode, SanctionState, SanctionType } from "../domain/sanctions.ts";
import type { SanctionsReadPort } from "../public/index.ts";

interface SanctionRow {
  id: string; user_id: string; type: SanctionType; state: SanctionState; reason_code: SanctionReasonCode; reason_note: string | null; evidence_url: string | null;
  starts_at: Date; ends_at: Date | null; created_by: string; cancelled_at: Date | null; cancelled_by: string | null; cancel_reason: string | null;
  idempotency_key: string; idempotency_payload_hash: Buffer; created_at: Date; updated_at: Date;
}
interface SanctionAppealRow {
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
  async insertSanction(input: Omit<Sanction, "id" | "createdAt" | "updatedAt">): Promise<Sanction> {
    const result = await this.pool.query<SanctionRow>(
      `insert into sanctions (user_id, type, state, reason_code, reason_note, evidence_url, starts_at, ends_at, created_by, cancelled_at, cancelled_by, cancel_reason, idempotency_key, idempotency_payload_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning ${SANCTION_COLUMNS}`,
      [input.userId, input.type, input.state, input.reasonCode, input.reasonNote, input.evidenceUrl, input.startsAt, input.endsAt, input.createdBy, input.cancelledAt, input.cancelledBy, input.cancelReason, input.idempotencyKey, input.idempotencyPayloadHash],
    );
    return sanctionFromRow(result.rows[0]!);
  }
  async insertAppeal(input: Omit<SanctionAppeal, "id" | "submittedAt" | "createdAt" | "updatedAt"> & { readonly submittedAt?: Date }): Promise<SanctionAppeal> {
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
}
