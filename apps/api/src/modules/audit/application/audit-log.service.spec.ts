import { describe, expect, it, vi } from "vitest";
import { AuditLogService } from "./audit-log.service.ts";

const event = () => ({ schema_version: 1 as const, id: "00000000-0000-4000-8000-000000000001", actor_user_id: null, actor_type: "system" as const, subject_type: "user", subject_id: "00000000-0000-4000-8000-000000000002", action: "auth.login.failed" as const, before_state: null, after_state: { reason: "invalid_password" }, reason: "invalid_password", correlation_id: "request", causation_id: null, idempotency_key: "login:1", occurred_at: new Date(), legal_hold: false });

describe("AuditLogService", () => {
  it("passes the event and optional transaction client to the repository", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const service = new AuditLogService({ insert } as never);
    const client = {} as never;
    await service.record(event(), client);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ idempotency_key: "login:1" }), client);
  });
  it("does not call the repository when a payload contains a secret", async () => {
    const insert = vi.fn(); const service = new AuditLogService({ insert } as never);
    await expect(service.record({ ...event(), after_state: { secret: "no" } as never })).rejects.toThrow("secret");
    expect(insert).not.toHaveBeenCalled();
  });
});
