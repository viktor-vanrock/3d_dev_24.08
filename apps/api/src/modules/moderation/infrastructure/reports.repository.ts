import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { OwnedReport, ReportsPort, ReportSubjectType } from "../public/index.ts";

@Injectable()
export class ReportsRepository implements ReportsPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async enqueue(subjectType: ReportSubjectType, subjectId: string, reporterId: UserId, reason: string | null): Promise<{ readonly openCount: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into reports (subject_type, subject_id, reporter_id, reason)
         values ($1, $2, $3, $4)
         on conflict (subject_type, subject_id, reporter_id) do nothing`,
        [subjectType, subjectId, reporterId, reason],
      );
      const count = await client.query<{ count: string }>(`select count(*) as count from reports where subject_type = $1 and subject_id = $2 and status = 'open'`, [
        subjectType,
        subjectId,
      ]);
      await client.query("commit");
      return { openCount: Number(count.rows[0]?.count ?? 0) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveOpen(subjectType: ReportSubjectType, subjectId: string): Promise<void> {
    await this.pool.query(
      `update reports set status = 'resolved', resolved_at = now()
       where subject_type = $1 and subject_id = $2 and status = 'open'`,
      [subjectType, subjectId],
    );
  }

  async lock(client: PoolClient, reportId: string, subjectType: ReportSubjectType, subjectId: string): Promise<OwnedReport | null> {
    const result = await client.query<OwnedReport>(
      `select id, subject_type, subject_id, reason, resolved_at
       from reports where id = $1 and subject_type = $2 and subject_id = $3 for update`,
      [reportId, subjectType, subjectId],
    );
    return result.rows[0] ?? null;
  }

  async resolve(client: PoolClient, reportId: string, actorId: UserId, decision: "accepted" | "rejected"): Promise<void> {
    await client.query(`update reports set status = 'resolved', resolved_at = now(), resolved_by = $2, decision = $3 where id = $1`, [reportId, actorId, decision]);
  }
}
