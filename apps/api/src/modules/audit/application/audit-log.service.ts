import { Inject, Injectable } from "@nestjs/common";
import type { AuditEvent } from "@portal/contracts/audit/audit-event";
import type { AuditPayload, ForbiddenFields } from "@portal/contracts/audit/audit-payload";
import type { PoolClient } from "pg";
import type { AuditLogPort } from "../domain/audit-log.port.ts";
import { PostgresAuditLogRepository } from "../infrastructure/postgres-audit-log.repository.ts";

const FORBIDDEN_FIELDS: readonly ForbiddenFields[] = ["password", "token", "cookie", "secret", "verificationCode"];

export function assertSafePayload(value: AuditPayload | null, path = "payload"): void {
  if (value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.includes(key as ForbiddenFields)) throw new Error(`Audit payload contains forbidden field: ${path}.${key}`);
    if (child !== null && typeof child === "object") assertSafePayload(child as AuditPayload, `${path}.${key}`);
  }
}

@Injectable()
export class AuditLogService implements AuditLogPort {
  constructor(@Inject(PostgresAuditLogRepository) private readonly repository: PostgresAuditLogRepository) {}

  async record(event: AuditEvent, client?: PoolClient): Promise<void> {
    assertSafePayload(event.before_state, "before_state");
    assertSafePayload(event.after_state, "after_state");
    await this.repository.insert(event, client);
  }
}
