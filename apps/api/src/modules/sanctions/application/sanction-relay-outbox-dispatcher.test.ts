import { describe, expect, it, vi } from "vitest";
import type { ClaimedOutboxEvent, OutboxPort } from "../../projects/public/index.ts";
import { SanctionRelayOutboxDispatcher, relayRetryBackoffSeconds, sanitizeRelayDispatchError } from "./sanction-relay-outbox-dispatcher.ts";

function event(agentIds: readonly string[], attemptCount = 0, id = "event-1"): ClaimedOutboxEvent {
  return { id, aggregateType: "Sanction", aggregateId: "sanction-1", eventType: "sanction.relay_close.v1", eventVersion: 1, payload: { sanction_id: "sanction-1", user_id: "user-1", agent_ids: agentIds, reason: "owner_sanctioned" }, attemptCount };
}
function setup(events: readonly ClaimedOutboxEvent[]) {
  const outbox = { claim: vi.fn().mockResolvedValue(events), complete: vi.fn().mockResolvedValue(undefined), retry: vi.fn().mockResolvedValue(undefined) } as unknown as OutboxPort;
  const relay = { closeAgentSessions: vi.fn().mockResolvedValue({ closed: [], notConnected: [] }) };
  return { outbox, relay, dispatcher: new SanctionRelayOutboxDispatcher(outbox, relay as never) };
}

describe("SanctionRelayOutboxDispatcher", () => {
  it.each([{ size: 5, calls: [5] }, { size: 150, calls: [100, 50] }, { size: 201, calls: [100, 100, 1] }])("closes $size agents in relay-sized chunks", async ({ size, calls }) => {
    const { dispatcher, relay, outbox } = setup([event(Array.from({ length: size }, (_, index) => `agent-${index}`))]);
    await expect(dispatcher.dispatchDueRelayCloseEvents({ limit: 100, workerId: "worker" })).resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(relay.closeAgentSessions.mock.calls.map(([ids]) => ids.length)).toEqual(calls);
    expect(relay.closeAgentSessions.mock.calls.every(([, reason]) => reason === "owner_sanctioned")).toBe(true);
    expect(outbox.complete).toHaveBeenCalledOnce();
  });

  it("completes zero-agent events without calling Relay and does nothing for an empty claim", async () => {
    const zero = setup([event([])]); await expect(zero.dispatcher.dispatchDueRelayCloseEvents({ limit: 100, workerId: "worker" })).resolves.toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(zero.relay.closeAgentSessions).not.toHaveBeenCalled();
    const empty = setup([]); await expect(empty.dispatcher.dispatchDueRelayCloseEvents({ limit: 100, workerId: "worker" })).resolves.toEqual({ claimed: 0, completed: 0, failed: 0 });
    expect(empty.outbox.complete).not.toHaveBeenCalled();
  });

  it("retries the entire event when a chunk fails and continues processing other events", async () => {
    const { dispatcher, relay, outbox } = setup([event(Array.from({ length: 150 }, (_, index) => `agent-${index}`), 1), event(["agent-ok"], 0, "event-2")]);
    relay.closeAgentSessions.mockResolvedValueOnce({ closed: [], notConnected: [] }).mockRejectedValueOnce(new Error("relay token=secret\nfailed")).mockResolvedValueOnce({ closed: [], notConnected: ["agent-ok"] });
    const before = Date.now();
    await expect(dispatcher.dispatchDueRelayCloseEvents({ limit: 100, workerId: "worker" })).resolves.toEqual({ claimed: 2, completed: 1, failed: 1 });
    expect(outbox.complete).toHaveBeenCalledTimes(1); expect(outbox.retry).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-1", availableAt: expect.any(Date), lastErrorSafe: "relay token=secret failed" }));
    expect((outbox.retry as ReturnType<typeof vi.fn>).mock.calls[0]![0].availableAt.getTime()).toBeGreaterThan(before);
  });

  it("caps retry backoff at five minutes and bounds the stored error", () => {
    expect(relayRetryBackoffSeconds(100)).toBe(300);
    expect(sanitizeRelayDispatchError(new Error("x".repeat(300)))).toHaveLength(256);
  });
});
