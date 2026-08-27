import { createHash } from "node:crypto";
import type { SanctionAppealId, SanctionId, UserId } from "../../_kernel/brandedIds.ts";

export const SANCTION_TYPES = ["suspension", "ban"] as const;
export const SANCTION_STATES = ["active", "cancelled", "expired"] as const;
export const SANCTION_REASON_CODES = ["spam", "abuse", "fraud", "tos_violation", "security", "other", "legacy"] as const;
export const SANCTION_APPEAL_STATES = ["pending", "accepted", "rejected"] as const;

export type SanctionType = (typeof SANCTION_TYPES)[number];
export type SanctionState = (typeof SANCTION_STATES)[number];
export type SanctionReasonCode = (typeof SANCTION_REASON_CODES)[number];
export type SanctionAppealState = (typeof SANCTION_APPEAL_STATES)[number];

export interface Sanction {
  readonly id: ReturnType<typeof SanctionId>;
  readonly userId: UserId;
  readonly type: SanctionType;
  readonly state: SanctionState;
  readonly reasonCode: SanctionReasonCode;
  readonly reasonNote: string | null;
  readonly evidenceUrl: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly createdBy: UserId;
  readonly cancelledAt: Date | null;
  readonly cancelledBy: UserId | null;
  readonly cancelReason: string | null;
  readonly idempotencyKey: string;
  readonly idempotencyPayloadHash: Buffer;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SanctionAppeal {
  readonly id: ReturnType<typeof SanctionAppealId>;
  readonly sanctionId: ReturnType<typeof SanctionId>;
  readonly submittedBy: UserId;
  readonly submittedAt: Date;
  readonly message: string;
  readonly state: SanctionAppealState;
  readonly resolvedBy: UserId | null;
  readonly resolvedAt: Date | null;
  readonly resolutionNote: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Stable identity for retries; free-text evidence belongs to the first successful request. */
export function sanctionIdempotencyPayloadHash(input: {
  readonly userId: UserId;
  readonly type: SanctionType;
  readonly reasonCode: SanctionReasonCode;
  readonly endsAt: Date | null;
}): Buffer {
  return createHash("sha256")
    .update(`${input.userId}\0${input.type}\0${input.reasonCode}\0${input.endsAt?.toISOString() ?? ""}`, "utf8")
    .digest();
}
