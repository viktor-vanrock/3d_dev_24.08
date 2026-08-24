import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, CommandResult } from "@portal/contracts/device-protocol/v1";
import type { RelayClaimedCommandDto } from "@portal/contracts/http/relay-internal.v1.dto";
import type { RelayApiClient } from "../api/relay-api-client.service.ts";
import type { RelayConfig } from "../config/relay-config.ts";
import type { RelayLogger } from "../observability/relay-logger.ts";
import type { RelayMetrics } from "../observability/metrics.service.ts";
import { CommandDeliveryService, type CommandDeliveryOptions } from "./command-delivery.service.ts";
import type { CommandSessionFence, CommandSessionPort, LiveCommandSession } from "./command-session.port.ts";

const firstSession: LiveCommandSession = {
  gatewayId: "gateway-1",
  sessionId: "session-1",
  sessionGeneration: 1,
  connectionId: "connection-1",
  authorizationRevision: 7,
  authorizedDeviceIds: ["device-1", "device-2"],
};

function claimed(overrides: Partial<RelayClaimedCommandDto> = {}): RelayClaimedCommandDto {
  return {
    command_id: "command-1",
    device_id: "device-1",
    command_seq: 1,
    status: "leased",
    claim_owner: "relay-test",
    claim_token: "opaque-claim-token-1",
    command_token: "opaque-command-token-1",
    generation: 1,
    attempt_count: 1,
    max_attempts: 3,
    lease_expires_at: "2026-08-11T12:00:10.000Z",
    expires_at: "2026-08-11T13:00:00.000Z",
    payload: { command: "pause" },
    ...overrides,
  };
}

interface Harness {
  readonly service: CommandDeliveryService;
  readonly api: {
    relayCommandsClaim: ReturnType<typeof vi.fn>;
    relayCommandLeaseHeartbeat: ReturnType<typeof vi.fn>;
    relayCommandResult: ReturnType<typeof vi.fn>;
  };
  readonly sessions: CommandSessionPort & {
    live: LiveCommandSession[];
    currentConnectionId: string;
    sent: Array<{ readonly session: CommandSessionFence; readonly frame: Command }>;
  };
}

function harness(claims: RelayClaimedCommandDto[][], optionOverrides: Partial<CommandDeliveryOptions> = {}): Harness {
  const api = {
    relayCommandsClaim: vi.fn().mockImplementation(async () => ({
      claim_owner: "relay-test",
      claimed_at: new Date().toISOString(),
      commands: claims.shift() ?? [],
      replayed: false,
    })),
    relayCommandLeaseHeartbeat: vi.fn().mockImplementation(async (input: { body: { delivery_state: "leased" | "delivered" | "acknowledged" }; path: { commandId: string } }) => ({
      command_id: input.path.commandId,
      generation: 1,
      lease_expires_at: new Date(Date.now() + 10_000).toISOString(),
      replayed: false,
      status: input.body.delivery_state,
    })),
    relayCommandResult: vi.fn().mockImplementation(async (input: { body: { command_seq: number; generation: number; status: "executed" | "failed" }; path: { commandId: string } }) => ({
      command_id: input.path.commandId,
      command_seq: input.body.command_seq,
      generation: input.body.generation,
      persisted_at: new Date().toISOString(),
      replayed: false,
      status: input.body.status,
    })),
  };
  const sessions = {
    live: [firstSession],
    currentConnectionId: firstSession.connectionId,
    sent: [] as Array<{ readonly session: CommandSessionFence; readonly frame: Command }>,
    listLiveAuthorizedSessions() { return this.live; },
    isCurrent(session: CommandSessionFence) { return session.connectionId === this.currentConnectionId; },
    sendCommand(session: CommandSessionFence, frame: Command) {
      this.sent.push({ session, frame });
      return this.isCurrent(session);
    },
  };
  const config = { instanceId: "relay-test", gateway: { shutdownDrainMs: 50 } } as RelayConfig;
  const metrics = { recordCommand: vi.fn() } as unknown as RelayMetrics;
  const logger = { warn: vi.fn() } as unknown as RelayLogger;
  const options: CommandDeliveryOptions = {
    claimBatchSize: 10,
    maxConcurrentCommands: 10,
    claimIntervalMs: 60_000,
    leaseHeartbeatMs: 5_000,
    commandTimeoutMs: 30_000,
    completedLedgerSize: 10,
    ...optionOverrides,
  };
  const client = { v1: api } as unknown as RelayApiClient;
  return { service: new CommandDeliveryService(client, sessions, config, metrics, logger, options), api, sessions };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("CommandDeliveryService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("claims a bounded batch and dispatches different devices concurrently", async () => {
    const commands = [
      claimed(),
      claimed({ command_id: "command-2", device_id: "device-2", command_seq: 8, claim_token: "claim-2", command_token: "wire-2" }),
    ];
    const test = harness([commands], { claimBatchSize: 2, maxConcurrentCommands: 2 });

    test.service.start();
    await settle();

    expect(test.api.relayCommandsClaim).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ limit: 2 }) }));
    expect(test.sessions.sent.map(({ frame }) => frame.command_id)).toEqual(["command-1", "command-2"]);
    expect(test.service.activeCount).toBe(2);
    expect(test.api.relayCommandLeaseHeartbeat).toHaveBeenCalledTimes(2);
    expect(test.api.relayCommandLeaseHeartbeat.mock.calls.map(([input]) => input.body.delivery_state)).toEqual(["delivered", "delivered"]);
    test.service.handleDisconnect(firstSession);
  });

  it("persists ACK as acknowledged without treating it as terminal execution", async () => {
    const test = harness([[claimed()]]);
    test.service.start();
    await settle();

    const outcome = await test.service.handleAcknowledged(firstSession, {
      type: "command_ack",
      device_id: "device-1",
      command_id: "command-1",
      command_seq: 1,
    });

    expect(outcome).toEqual({ accepted: true, replayed: false });
    expect(test.api.relayCommandLeaseHeartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ delivery_state: "acknowledged" }) }));
    expect(test.api.relayCommandResult).not.toHaveBeenCalled();
    expect(test.service.activeCount).toBe(1);
    test.service.handleDisconnect(firstSession);
  });

  it.each([
    [{ type: "command_result", device_id: "device-1", command_id: "command-1", command_seq: 1, outcome: "executed" } as const, "executed", undefined],
    [{ type: "command_result", device_id: "device-1", command_id: "command-1", command_seq: 1, outcome: "failed", error_code: "command_failed" } as const, "failed", "command_failed"],
  ])("persists explicit terminal result %#", async (frame, status, errorCode) => {
    const test = harness([[claimed()]]);
    test.service.start();
    await settle();

    expect(await test.service.handleResult(firstSession, frame)).toEqual({ accepted: true, replayed: false });
    expect(test.api.relayCommandResult).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ status, ...(errorCode ? { error_code: errorCode } : {}) }),
    }));
    expect(test.service.activeCount).toBe(0);
  });

  it("fails an unanswered command on the bounded execution timeout", async () => {
    const test = harness([[claimed()]], { commandTimeoutMs: 1_000, leaseHeartbeatMs: 250 });
    test.service.start();
    await settle();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(test.api.relayCommandResult).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ status: "failed", error_code: "timeout" }) }));
    expect(test.service.activeCount).toBe(0);
  });

  it("leaves disconnected work reclaimable and fences stale results after reconnect", async () => {
    const reclaimed = claimed({ claim_token: "new-fence", generation: 2, attempt_count: 2 });
    const test = harness([[claimed()], [reclaimed]]);
    test.service.start();
    await settle();
    test.service.handleDisconnect(firstSession);
    expect(test.api.relayCommandResult).not.toHaveBeenCalled();

    const reconnected: LiveCommandSession = { ...firstSession, sessionId: "session-2", sessionGeneration: 2, connectionId: "connection-2" };
    test.sessions.live = [reconnected];
    test.sessions.currentConnectionId = reconnected.connectionId;
    await test.service.claimOnce();
    await settle();

    const result: CommandResult = { type: "command_result", device_id: "device-1", command_id: "command-1", command_seq: 1, outcome: "executed" };
    expect(await test.service.handleResult(firstSession, result)).toEqual({ accepted: false, replayed: false });
    expect(await test.service.handleResult(reconnected, result)).toEqual({ accepted: true, replayed: false });
    expect(await test.service.handleResult(reconnected, result)).toEqual({ accepted: true, replayed: true });
    expect(test.api.relayCommandResult).toHaveBeenCalledTimes(1);
    expect(test.api.relayCommandResult).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ claim_token: "new-fence", generation: 2 }) }));
  });

  it("coalesces duplicate result frames while the API write is in flight", async () => {
    let resolveResult: ((value: { command_id: string; command_seq: number; generation: number; persisted_at: string; replayed: boolean; status: "executed" }) => void) | undefined;
    const test = harness([[claimed()]]);
    test.api.relayCommandResult.mockImplementation(() => new Promise((resolve) => { resolveResult = resolve; }));
    test.service.start();
    await settle();
    const frame = { type: "command_result", device_id: "device-1", command_id: "command-1", command_seq: 1, outcome: "executed" } as const;

    const first = test.service.handleResult(firstSession, frame);
    const duplicate = test.service.handleResult(firstSession, frame);
    expect(test.api.relayCommandResult).toHaveBeenCalledTimes(1);
    resolveResult?.({ command_id: "command-1", command_seq: 1, generation: 1, persisted_at: new Date().toISOString(), replayed: false, status: "executed" });

    expect(await first).toEqual({ accepted: true, replayed: false });
    expect(await duplicate).toEqual({ accepted: true, replayed: false });
  });
});
