import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { ClaimedOutboxEvent, OutboxPort } from "../public/outbox.ts";

interface OutboxRow { id: string; aggregate_type: string; aggregate_id: string; event_type: string; event_version: number; payload: Record<string, unknown>; attempt_count: number; }
function mapRow(row: OutboxRow): ClaimedOutboxEvent {
  return { id: row.id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, eventType: row.event_type, eventVersion: row.event_version, payload: row.payload, attemptCount: row.attempt_count };
}

/** Private implementation of the transitional, domain-neutral outbox facade. */
@Injectable()
export class ProjectsOutboxRepository implements OutboxPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}
  async enqueue(tx: PoolClient, event: { readonly aggregateType: string; readonly aggregateId: string; readonly eventType: string; readonly eventVersion: number; readonly payload: Record<string, unknown> }): Promise<{ readonly id: string }> {
    const result = await tx.query<{ id: string }>(
      `insert into outbox_events(aggregate_type, aggregate_id, event_type, event_version, payload) values ($1, $2::uuid, $3, $4, $5) returning id::text as id`,
      [event.aggregateType, event.aggregateId, event.eventType, event.eventVersion, event.payload],
    );
    return { id: result.rows[0]!.id };
  }
  async claim(input: { readonly limit: number; readonly workerId: string; readonly leaseSeconds: number; readonly eventTypes?: readonly string[] }): Promise<readonly ClaimedOutboxEvent[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<OutboxRow>(
        `with candidates as (
           select id from outbox_events
            where completed_at is null and available_at <= now() and (locked_at is null or locked_at < now() - make_interval(secs => $3))
              and ($4::text[] is null or event_type = any($4::text[]))
            order by available_at, created_at
            for update skip locked limit $1
         ) update outbox_events o set locked_at = now(), locked_by = $2
           from candidates where o.id = candidates.id
         returning o.id::text, o.aggregate_type, o.aggregate_id::text, o.event_type, o.event_version, o.payload, o.attempt_count`,
        [input.limit, input.workerId, input.leaseSeconds, input.eventTypes === undefined ? null : [...input.eventTypes]],
      );
      await client.query("commit");
      return result.rows.map(mapRow);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  async complete(input: { readonly eventId: string; readonly workerId: string }): Promise<void> {
    await this.pool.query(`update outbox_events set completed_at = now(), locked_at = null, locked_by = null where id = $1 and locked_by = $2`, [input.eventId, input.workerId]);
  }
  async retry(input: { readonly eventId: string; readonly workerId: string; readonly availableAt: Date; readonly lastErrorSafe: string }): Promise<void> {
    await this.pool.query(
      `update outbox_events set attempt_count = attempt_count + 1, available_at = $3, last_error_safe = $4, locked_at = null, locked_by = null where id = $1 and locked_by = $2`,
      [input.eventId, input.workerId, input.availableAt, input.lastErrorSafe],
    );
  }
}
