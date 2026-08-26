import type { SanctionId, UserId } from "../../_kernel/brandedIds.ts";
import type { Sanction } from "../domain/sanctions.ts";

/** Read-only cross-domain surface. Mutation/cascade ports land in PR-3. */
export const SANCTIONS_READ_PORT = Symbol("SANCTIONS_READ_PORT");
export const SANCTIONS_PORT = Symbol("SANCTIONS_PORT");
export const SANCTIONS_RELAY_DISPATCH_PORT = Symbol("SANCTIONS_RELAY_DISPATCH_PORT");

export interface SanctionsReadPort {
  findActiveForUser(userId: UserId): Promise<Sanction | null>;
  listHistoryForUser(userId: UserId): Promise<readonly Sanction[]>;
}

export type CreateSanctionCommand = {
  readonly actorId: UserId;
  readonly targetId: UserId;
  readonly type: "suspension" | "ban";
  readonly reasonCode: "spam" | "abuse" | "fraud" | "tos_violation" | "security" | "other";
  readonly reasonNote: string | null;
  readonly evidenceUrl: string | null;
  readonly endsAt: Date | null;
  readonly idempotencyKey: string;
};

export type SanctionRecord = Omit<Sanction, "idempotencyKey" | "idempotencyPayloadHash">;

export type CascadeResult = {
  readonly sessionVersion: number;
  readonly agentIds: readonly string[];
  readonly agentsRevoked: number;
  readonly enrollCodesRevoked: number;
  readonly apiKeysRevoked: number;
  readonly userApiKeysRevoked: number;
  readonly outboxEventId: string;
};

export type CreateSanctionResult = {
  readonly sanction: SanctionRecord;
  /** Cascade result is only returned for the first successful writer; matching retries return null. */
  readonly cascade: CascadeResult | null;
  readonly reused: boolean;
};

export type CancelSanctionCommand = { readonly actorId: UserId; readonly sanctionId: SanctionId; readonly cancelReason: string };

export interface SanctionsPort {
  create(input: CreateSanctionCommand): Promise<CreateSanctionResult>;
  cancel(input: CancelSanctionCommand): Promise<SanctionRecord>;
}

export interface SanctionsRelayDispatchPort {
  dispatchDueRelayCloseEvents(input: { readonly limit: number; readonly workerId: string }): Promise<{ readonly claimed: number; readonly completed: number; readonly failed: number }>;
}

export type { Sanction, SanctionAppeal, SanctionAppealState, SanctionReasonCode, SanctionState, SanctionType } from "../domain/sanctions.ts";
