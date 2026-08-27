import type { PoolClient } from "pg";

/** TRANSITIONAL: physical owner is projects; migration target is modules/outbox. */
export const OUTBOX_PORT = Symbol("OUTBOX_PORT");

export type ClaimedOutboxEvent = {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly attemptCount: number;
};

/** TRANSITIONAL: domain-neutral facade over projects-owned outbox_events. */
export interface OutboxPort {
  enqueue(tx: PoolClient, event: { readonly aggregateType: string; readonly aggregateId: string; readonly eventType: string; readonly eventVersion: number; readonly payload: Record<string, unknown> }): Promise<{ readonly id: string }>;
  claim(input: { readonly limit: number; readonly workerId: string; readonly leaseSeconds: number; readonly eventTypes?: readonly string[] }): Promise<readonly ClaimedOutboxEvent[]>;
  complete(input: { readonly eventId: string; readonly workerId: string }): Promise<void>;
  retry(input: { readonly eventId: string; readonly workerId: string; readonly availableAt: Date; readonly lastErrorSafe: string }): Promise<void>;
}
