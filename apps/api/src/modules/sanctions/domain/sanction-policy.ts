import { createHash } from "node:crypto";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { SanctionEndsAtInPastError, SanctionInvalidReasonCodeError, SanctionSelfTargetError } from "./sanction.errors.ts";
import type { SanctionReasonCode, SanctionType } from "./sanctions.ts";

export type IdempotencyPayload = { readonly userId: UserId; readonly type: SanctionType; readonly reasonCode: SanctionReasonCode; readonly endsAt: Date | null };

export function canonicalizeIdempotencyPayload(input: IdempotencyPayload): string {
  return `${input.userId}\0${input.type}\0${input.reasonCode}\0${input.endsAt?.toISOString() ?? ""}`;
}

export function computeIdempotencyHash(input: IdempotencyPayload): Buffer {
  return createHash("sha256").update(canonicalizeIdempotencyPayload(input), "utf8").digest();
}

export function assertCanCreate(input: IdempotencyPayload & { readonly actorId: UserId; readonly now?: Date }): void {
  if (input.actorId === input.userId) throw new SanctionSelfTargetError();
  if (input.reasonCode === "legacy") throw new SanctionInvalidReasonCodeError();
  if (input.endsAt !== null && input.endsAt <= (input.now ?? new Date())) throw new SanctionEndsAtInPastError();
}
