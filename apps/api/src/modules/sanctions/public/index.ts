import type { UserId } from "../../_kernel/brandedIds.ts";
import type { Sanction } from "../domain/sanctions.ts";

/** Read-only cross-domain surface. Mutation/cascade ports land in PR-3. */
export const SANCTIONS_READ_PORT = Symbol("SANCTIONS_READ_PORT");

export interface SanctionsReadPort {
  findActiveForUser(userId: UserId): Promise<Sanction | null>;
  listHistoryForUser(userId: UserId): Promise<readonly Sanction[]>;
}

export type { Sanction, SanctionAppeal, SanctionAppealState, SanctionReasonCode, SanctionState, SanctionType } from "../domain/sanctions.ts";
