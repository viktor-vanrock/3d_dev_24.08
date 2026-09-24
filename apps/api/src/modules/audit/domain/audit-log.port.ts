import type { AuditEvent } from "@portal/contracts/audit/audit-event";
import type { PoolClient } from "pg";

export const AUDIT_LOG_PORT = Symbol("AUDIT_LOG_PORT");

export interface AuditLogPort {
  record(event: AuditEvent, client?: PoolClient): Promise<void>;
}
