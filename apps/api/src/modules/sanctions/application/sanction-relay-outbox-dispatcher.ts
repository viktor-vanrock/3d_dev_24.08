import { Inject, Injectable } from "@nestjs/common";
import { DEVICE_RELAY_PUSH_PORT, type DeviceRelayPushPort } from "../../devices/public/index.ts";
import { OUTBOX_PORT, type ClaimedOutboxEvent, type OutboxPort } from "../../projects/public/index.ts";
import type { SanctionsRelayDispatchPort } from "../public/index.ts";

const RELAY_BATCH_SIZE = 100;
const LEASE_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 300;

type RelayClosePayload = { readonly sanction_id: string; readonly user_id: string; readonly agent_ids: readonly string[]; readonly reason: string };

function payloadOf(event: ClaimedOutboxEvent): RelayClosePayload {
  return event.payload as unknown as RelayClosePayload;
}

export function relayCloseChunks(agentIds: readonly string[]): readonly (readonly string[])[] {
  return Array.from({ length: Math.ceil(agentIds.length / RELAY_BATCH_SIZE) }, (_, index) => agentIds.slice(index * RELAY_BATCH_SIZE, (index + 1) * RELAY_BATCH_SIZE));
}

export function relayRetryBackoffSeconds(attemptCount: number): number {
  return Math.min(2 ** Math.max(0, attemptCount), MAX_BACKOFF_SECONDS);
}

export function sanitizeRelayDispatchError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "relay_close_failed";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 256) || "relay_close_failed";
}

@Injectable()
export class SanctionRelayOutboxDispatcher implements SanctionsRelayDispatchPort {
  constructor(
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(DEVICE_RELAY_PUSH_PORT) private readonly relay: DeviceRelayPushPort,
  ) {}

  async dispatchDueRelayCloseEvents(input: { readonly limit: number; readonly workerId: string }): Promise<{ readonly claimed: number; readonly completed: number; readonly failed: number }> {
    const events = await this.outbox.claim({ limit: input.limit, workerId: input.workerId, leaseSeconds: LEASE_SECONDS, eventTypes: ["sanction.relay_close.v1"] });
    let completed = 0;
    let failed = 0;
    for (const event of events) {
      const payload = payloadOf(event);
      try {
        for (const chunk of relayCloseChunks(payload.agent_ids)) await this.relay.closeAgentSessions(chunk, "owner_sanctioned");
        await this.outbox.complete({ eventId: event.id, workerId: input.workerId });
        completed += 1;
      } catch (error) {
        failed += 1;
        await this.outbox.retry({
          eventId: event.id,
          workerId: input.workerId,
          availableAt: new Date(Date.now() + relayRetryBackoffSeconds(event.attemptCount) * 1_000),
          lastErrorSafe: sanitizeRelayDispatchError(error),
        });
      }
    }
    return { claimed: events.length, completed, failed };
  }
}
