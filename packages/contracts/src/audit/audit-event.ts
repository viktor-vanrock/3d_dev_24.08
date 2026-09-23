import type { AuditPayload } from "./audit-payload.ts";
import type { SensitiveCommand } from "./sensitive-commands.ts";

export interface AuditEvent {
  readonly schema_version: 1;
  readonly id: string;
  readonly actor_user_id: string | null;
  readonly actor_type: "user" | "system" | "background_job";
  readonly subject_type: string;
  readonly subject_id: string;
  readonly action: SensitiveCommand;
  readonly before_state: AuditPayload | null;
  readonly after_state: AuditPayload | null;
  readonly reason: string | null;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly idempotency_key: string;
  readonly occurred_at: Date;
  readonly legal_hold: boolean;
}
