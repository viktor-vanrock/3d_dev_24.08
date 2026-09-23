import { Inject, Injectable } from "@nestjs/common";
import type { AuditEvent } from "@portal/contracts/audit/audit-event";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";

@Injectable()
export class PostgresAuditLogRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async insert(event: AuditEvent, client?: PoolClient): Promise<void> {
    const db = client ?? this.pool;
    await db.query(
      `insert into audit_log(
        id, actor_user_id, action, target_type, target_id, details, created_at,
        schema_version, actor_type, before_state, after_state, reason, correlation_id,
        causation_id, idempotency_key, legal_hold
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      on conflict (idempotency_key) where idempotency_key is not null do nothing`,
      [
        event.id, event.actor_user_id, event.action, event.subject_type, event.subject_id,
        JSON.stringify({}), event.occurred_at, event.schema_version, event.actor_type,
        event.before_state === null ? null : JSON.stringify(event.before_state),
        event.after_state === null ? null : JSON.stringify(event.after_state), event.reason,
        event.correlation_id, event.causation_id, event.idempotency_key, event.legal_hold,
      ],
    );
  }

  async list(filters: { actorUserId?: string; subjectType?: string; subjectId?: string; action?: string; from?: Date; to?: Date; limit: number; offset: number }) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
    if (filters.actorUserId !== undefined) add("actor_user_id = ?::uuid", filters.actorUserId);
    if (filters.subjectType !== undefined) add("target_type = ?", filters.subjectType);
    if (filters.subjectId !== undefined) add("target_id = ?::uuid", filters.subjectId);
    if (filters.action !== undefined) add("action = ?", filters.action);
    if (filters.from !== undefined) add("created_at >= ?", filters.from);
    if (filters.to !== undefined) add("created_at <= ?", filters.to);
    const where = clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`;
    const count = await this.pool.query<{ total: string }>(`select count(*)::text as total from audit_log ${where}`, values);
    values.push(filters.limit, filters.offset);
    const rows = await this.pool.query(`select id,actor_user_id,action,target_type as subject_type,target_id as subject_id,created_at as occurred_at,schema_version,actor_type,before_state,after_state,reason,correlation_id,causation_id,idempotency_key,legal_hold from audit_log ${where} order by created_at desc limit $${values.length - 1} offset $${values.length}`, values);
    return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  async setLegalHold(id: string): Promise<boolean> {
    const result = await this.pool.query(`select public.audit_log_set_legal_hold($1::uuid)`, [id]);
    return result.rowCount === 1;
  }

  async cleanup(): Promise<number> {
    const result = await this.pool.query(`delete from audit_log where created_at < now() - interval '3 months' and legal_hold = false`);
    return result.rowCount ?? 0;
  }

  async health() {
    const result = await this.pool.query<{ write_errors_last_hour: string; latest_event_age_seconds: string | null; export_operations_last_30_days: string }>(
      `select
         0::bigint as write_errors_last_hour,
         extract(epoch from now() - max(created_at))::text as latest_event_age_seconds,
         count(*) filter (where action = 'audit.exported' and created_at >= now() - interval '30 days')::text as export_operations_last_30_days
       from audit_log`,
    );
    return result.rows[0]!;
  }
}
