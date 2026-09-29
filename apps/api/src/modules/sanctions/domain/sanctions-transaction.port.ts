import type { PoolClient } from "pg";
import type { Sanction } from "./sanctions.ts";
export interface CreateSanctionInTransactionInput { readonly actorId: string; readonly targetUserId: string; readonly type: "suspension" | "ban"; readonly reasonCode: string; readonly reasonNote: string | null; readonly evidenceUrl: string | null; readonly endsAt: Date | null; readonly idempotencyKey: string; readonly idempotencyPayloadHash: Buffer; }
export interface SanctionsTransactionPort {
  findActiveSanctionForUser(userId: string): Promise<{ id: string; type: string; endsAt: Date | null } | null>;
  createInTransaction(tx: PoolClient, input: CreateSanctionInTransactionInput): Promise<Sanction>;
  cancelInTransaction(
    tx: PoolClient,
    input: { readonly sanctionId: string; readonly cancelledBy: string; readonly cancelReason: string },
  ): Promise<void>;
}
export const SANCTIONS_TRANSACTION_PORT = Symbol("SANCTIONS_TRANSACTION_PORT");
