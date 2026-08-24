import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PoolClient } from "pg";

export const MODERATION_PORT = Symbol("MODERATION_PORT");
export const REPORTS_PORT = Symbol("REPORTS_PORT");

export type ReportSubjectType = "make" | "model";

export interface OwnedReport {
  readonly id: string;
  readonly subject_type: ReportSubjectType;
  readonly subject_id: string;
  readonly reason: string | null;
  readonly resolved_at: Date | null;
}

export interface ReportsPort {
  enqueue(subjectType: ReportSubjectType, subjectId: string, reporterId: UserId, reason: string | null): Promise<{ readonly openCount: number }>;
  resolveOpen(subjectType: ReportSubjectType, subjectId: string): Promise<void>;
  lock(client: PoolClient, reportId: string, subjectType: ReportSubjectType, subjectId: string): Promise<OwnedReport | null>;
  resolve(client: PoolClient, reportId: string, actorId: UserId, decision: "accepted" | "rejected"): Promise<void>;
}

export interface ModerationPort {
  banUser(actorId: UserId, targetId: UserId): Promise<{ readonly id: UserId; readonly status: "banned" }>;
}
