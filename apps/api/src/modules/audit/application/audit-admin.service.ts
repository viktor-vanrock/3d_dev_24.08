import { Injectable } from "@nestjs/common";
import { PostgresAuditLogRepository } from "../infrastructure/postgres-audit-log.repository.ts";

export interface AuditLogFilters { readonly actorUserId?: string; readonly subjectType?: string; readonly subjectId?: string; readonly action?: string; readonly from?: Date; readonly to?: Date; readonly limit: number; readonly offset: number; }

@Injectable()
export class AuditAdminService {
  constructor(private readonly repository: PostgresAuditLogRepository) {}
  list(filters: AuditLogFilters) { return this.repository.list(filters); }
  health() { return this.repository.health(); }
  setLegalHold(id: string) { return this.repository.setLegalHold(id); }
}
