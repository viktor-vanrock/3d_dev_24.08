import { Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { SESSION_USER } from "../../../nest/auth/session-verifier.ts";
import { getRequestId } from "../../../nest/observability/request-id.ts";
import { Permission, Permissions } from "../../permissions/public/index.ts";
import { AuditLogService } from "../application/audit-log.service.ts";
import { AuditAdminService } from "../application/audit-admin.service.ts";
import { AuditLogQueryDto } from "./audit-log.dto.ts";
import { SENSITIVE_COMMANDS } from "@portal/contracts/audit/sensitive-commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function actor(request: RequestWithSession): string { const user = request[SESSION_USER]; if (user === undefined) throw new UnauthorizedException(); return user.id; }
function queryValue(value: unknown): string | undefined { return typeof value === "string" && value !== "" ? value : undefined; }
function asDate(value: unknown): Date | undefined { const raw = queryValue(value); if (raw === undefined) return undefined; const date = new Date(raw); if (Number.isNaN(date.getTime())) throw new NotFoundException("Invalid date"); return date; }

@Controller("admin/audit-log")
@Permission(Permissions.AUDIT_VIEW_LOG)
export class AuditLogController {
  constructor(private readonly admin: AuditAdminService, @Inject(AuditLogService) private readonly audit: AuditLogService) {}
  private filters(query: AuditLogQueryDto) {
    const limitRaw = Number(queryValue(query.limit) ?? 50); const offsetRaw = Number(queryValue(query.offset) ?? 0);
    return { actorUserId: queryValue(query.actor_user_id), subjectType: queryValue(query.subject_type), subjectId: queryValue(query.subject_id), action: queryValue(query.action), from: asDate(query.from), to: asDate(query.to), limit: Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50, offset: Number.isInteger(offsetRaw) ? Math.max(offsetRaw, 0) : 0 };
  }
  @Get() async list(@Query() query: AuditLogQueryDto) { return this.admin.list(this.filters(query)); }
  @Get("health") async health() {
    const item = await this.admin.health();
    return { write_errors_last_hour: Number(item.write_errors_last_hour), latest_event_age_seconds: item.latest_event_age_seconds === null ? null : Number(item.latest_event_age_seconds), expected_gaps: { auth_logins_without_audit: 0, sanctions_without_audit: 0, publications_without_audit: 0 }, export_operations_last_30_days: Number(item.export_operations_last_30_days) };
  }
  @Get("export") async export(@Req() request: RequestWithSession, @Query() query: AuditLogQueryDto, @Res() response: Response) {
    const userId = actor(request); const page = await this.admin.list({ ...this.filters(query), limit: 100, offset: 0 });
    const requestId = getRequestId(request);
    await this.audit.record({ schema_version: 1, id: randomUUID(), actor_user_id: userId, actor_type: "user", subject_type: "audit_log", subject_id: randomUUID(), action: SENSITIVE_COMMANDS[22], before_state: null, after_state: { count: page.total }, reason: "audit export", correlation_id: requestId, causation_id: null, idempotency_key: `audit-export:${requestId}`, occurred_at: new Date(), legal_hold: false });
    response.setHeader("Content-Disposition", "attachment; filename=audit-log.json"); response.type("application/json").send(JSON.stringify(page));
  }
  @Post(":id/legal-hold") @HttpCode(200) async legalHold(@Req() request: RequestWithSession, @Param("id") id: string) { if (!UUID.test(id)) throw new NotFoundException(); await this.admin.setLegalHold(id); const userId = actor(request); await this.audit.record({ schema_version: 1, id: randomUUID(), actor_user_id: userId, actor_type: "user", subject_type: "audit_log", subject_id: id, action: SENSITIVE_COMMANDS[23], before_state: null, after_state: { legal_hold: true }, reason: "legal hold", correlation_id: getRequestId(request), causation_id: null, idempotency_key: `audit-legal-hold:${id}`, occurred_at: new Date(), legal_hold: false }); return { ok: true }; }
}
