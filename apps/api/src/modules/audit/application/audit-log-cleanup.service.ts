import { Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PostgresAuditLogRepository } from "../infrastructure/postgres-audit-log.repository.ts";

/** Runs once at the next 03:00 and subsequently every 24 hours; records under legal hold are retained. */
@Injectable()
export class AuditLogCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditLogCleanupService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly repository: PostgresAuditLogRepository) {}

  onModuleInit(): void { this.schedule(); }
  onModuleDestroy(): void { if (this.timer !== undefined) clearTimeout(this.timer); }

  private schedule(): void {
    const now = new Date(); const next = new Date(now);
    next.setHours(3, 0, 0, 0); if (next <= now) next.setDate(next.getDate() + 1);
    this.timer = setTimeout(() => void this.run(), next.getTime() - now.getTime());
  }
  async run(): Promise<number> {
    try { const removed = await this.repository.cleanup(); this.logger.log(`Audit retention cleanup removed=${removed}`); return removed; }
    finally { this.schedule(); }
  }
}
