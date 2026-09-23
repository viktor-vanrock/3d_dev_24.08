import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { AuditLogService } from "./application/audit-log.service.ts";
import { AuditLogCleanupService } from "./application/audit-log-cleanup.service.ts";
import { AuditAdminService } from "./application/audit-admin.service.ts";
import { AuditLogController } from "./api/audit-log.controller.ts";
import { AUDIT_LOG_PORT } from "./domain/audit-log.port.ts";
import { PostgresAuditLogRepository } from "./infrastructure/postgres-audit-log.repository.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuditLogController],
  providers: [PostgresAuditLogRepository, AuditLogService, AuditAdminService, AuditLogCleanupService, { provide: AUDIT_LOG_PORT, useExisting: AuditLogService }],
  exports: [AUDIT_LOG_PORT, AuditLogService],
})
export class AuditModule {}
