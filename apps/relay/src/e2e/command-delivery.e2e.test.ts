import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RelayClaimedCommandDto } from "@portal/contracts/http/relay-internal.v1.dto";
import {
  createRelayE2eHarness,
  createTestCertificates,
  eventually,
  removeTestCertificates,
  type RelayE2eHarness,
  type TestCertificates,
} from "./relay-e2e-harness.ts";

interface LeaseWrite {
  readonly commandId: string;
  readonly state: "leased" | "delivered" | "acknowledged";
}

interface ResultWrite {
  readonly commandId: string;
  readonly status: "executed" | "failed";
  readonly errorCode?: string;
  readonly claimToken: string;
  readonly generation: number;
}

function claimed(commandId: string, overrides: Partial<RelayClaimedCommandDto> = {}): RelayClaimedCommandDto {
  return {
    command_id: commandId,
    device_id: "device-1",
    command_seq: 1,
    status: "leased",
    claim_owner: "relay-e2e",
    claim_token: `claim-${commandId}-1`,
    command_token: `wire-${commandId}-0123456789`,
    generation: 1,
    attempt_count: 1,
    max_attempts: 3,
    lease_expires_at: new Date(Date.now() + 10_000).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    payload: { command: "pause" },
    ...overrides,
  };
}

class CommandControlPlane {
  readonly claimBatches: RelayClaimedCommandDto[][] = [];
  readonly leaseWrites: LeaseWrite[] = [];
  readonly resultWrites: ResultWrite[] = [];
  private sessionGeneration = 0;

  async relaySessionAuthorize(): Promise<object> {
    this.sessionGeneration += 1;
    return {
      gateway_id: "gateway-1",
      session_id: `session-${this.sessionGeneration}`,
      session_generation: this.sessionGeneration,
      authorization_revision: 1,
      authorized_devices: [{ device_id: "device-1", authorization_revision: 1 }],
      pending_transfer_ids: [],
      heartbeat_interval_ms: 1_000,
      heartbeat_timeout_ms: 10_000,
    };
  }

  async relaySessionClose(): Promise<object> {
    return { session_id: `session-${this.sessionGeneration}`, session_generation: this.sessionGeneration, closed_at: new Date().toISOString(), replayed: false };
  }

  async relaySessionHeartbeat(): Promise<object> {
    return {
      session_id: `session-${this.sessionGeneration}`,
      session_generation: this.sessionGeneration,
      authorization_revision: 1,
      accepted_device_ids: ["device-1"],
      pending_transfer_ids: [],
      persisted_at: new Date().toISOString(),
      replayed: false,
    };
  }

  async relayGatewaysRevalidate(input: { readonly body: { readonly gateways: ReadonlyArray<{ readonly gateway_id: string; readonly session_id: string; readonly session_generation: number }> } }): Promise<object> {
    return {
      validated_at: new Date().toISOString(),
      results: input.body.gateways.map((gateway) => ({ ...gateway, state: "authorized", authorization_revision: 1, authorized_devices: [{ device_id: "device-1" }] })),
    };
  }

  async relayCommandsClaim(): Promise<object> {
    return { claim_owner: "relay-e2e", claimed_at: new Date().toISOString(), commands: this.claimBatches.shift() ?? [], replayed: false };
  }

  async relayCommandLeaseHeartbeat(input: { readonly path: { readonly commandId: string }; readonly body: { readonly delivery_state: LeaseWrite["state"] } }): Promise<object> {
    this.leaseWrites.push({ commandId: input.path.commandId, state: input.body.delivery_state });
    return {
      command_id: input.path.commandId,
      generation: 1,
      status: input.body.delivery_state,
      lease_expires_at: new Date(Date.now() + 10_000).toISOString(),
      replayed: false,
    };
  }

  async relayCommandResult(input: { readonly path: { readonly commandId: string }; readonly body: { readonly status: ResultWrite["status"]; readonly error_code?: string; readonly claim_token: string; readonly generation: number; readonly command_seq: number } }): Promise<object> {
    this.resultWrites.push({
      commandId: input.path.commandId,
      status: input.body.status,
      ...(input.body.error_code ? { errorCode: input.body.error_code } : {}),
      claimToken: input.body.claim_token,
      generation: input.body.generation,
    });
    return {
      command_id: input.path.commandId,
      command_seq: input.body.command_seq,
      generation: input.body.generation,
      status: input.body.status,
      persisted_at: new Date().toISOString(),
      replayed: false,
    };
  }
}

describe("relay command delivery over real WSS", () => {
  let certificates: TestCertificates;
  let harness: RelayE2eHarness | undefined;

  beforeAll(() => { certificates = createTestCertificates(); });
  afterEach(async () => { await harness?.shutdown(); harness = undefined; });
  afterAll(() => removeTestCertificates(certificates));

  it("delivers a canonical command, keeps ACK nonterminal, persists execution once, and coalesces duplicate results", async () => {
    const api = new CommandControlPlane();
    api.claimBatches.push([claimed("command-ack-result")]);
    harness = await createRelayE2eHarness({ certificates, apiV1: api });
    const gateway = await harness.connect(["cmd.pause"]);

    harness.commandDelivery.start();
    const command = await gateway.next("command");
    expect(command).toMatchObject({ command_id: "command-ack-result", device_id: "device-1", command_seq: 1, command: "pause", payload: {} });
    await eventually(() => expect(api.leaseWrites).toContainEqual({ commandId: command.command_id, state: "delivered" }));

    gateway.send({ type: "command_ack", device_id: command.device_id, command_id: command.command_id, command_seq: command.command_seq });
    await eventually(() => expect(api.leaseWrites).toContainEqual({ commandId: command.command_id, state: "acknowledged" }));
    expect(api.resultWrites).toEqual([]);
    expect(harness.commandDelivery.activeCount).toBe(1);

    const result = { type: "command_result", device_id: command.device_id, command_id: command.command_id, command_seq: command.command_seq, outcome: "executed" } as const;
    gateway.send(result);
    gateway.send(result);
    await eventually(() => expect(api.resultWrites).toEqual([{ commandId: command.command_id, status: "executed", claimToken: "claim-command-ack-result-1", generation: 1 }]));
    expect(harness.commandDelivery.activeCount).toBe(0);
  });

  it("persists a device error and fails an unanswered command on the execution timeout", async () => {
    const api = new CommandControlPlane();
    api.claimBatches.push([claimed("command-device-error")], [claimed("command-timeout", { command_seq: 2, claim_token: "claim-timeout", command_token: "wire-timeout-0123456789" })]);
    harness = await createRelayE2eHarness({ certificates, apiV1: api, commandOptions: { commandTimeoutMs: 80 } });
    const gateway = await harness.connect(["cmd.pause"]);

    harness.commandDelivery.start();
    const failed = await gateway.next("command");
    gateway.send({
      type: "command_result",
      device_id: failed.device_id,
      command_id: failed.command_id,
      command_seq: failed.command_seq,
      outcome: "failed",
      error_code: "command_failed",
      message: "safe device failure",
    });
    await eventually(() => expect(api.resultWrites).toContainEqual({ commandId: failed.command_id, status: "failed", errorCode: "command_failed", claimToken: "claim-command-device-error-1", generation: 1 }));

    await harness.commandDelivery.claimOnce();
    const unanswered = await gateway.next("command");
    expect(unanswered.command_id).toBe("command-timeout");
    await eventually(() => expect(api.resultWrites).toContainEqual({ commandId: unanswered.command_id, status: "failed", errorCode: "timeout", claimToken: "claim-timeout", generation: 1 }));
  });

  it("releases on disconnect, redelivers the same command after reconnect, and fences duplicate terminal frames", async () => {
    const api = new CommandControlPlane();
    api.claimBatches.push([claimed("command-reconnect")]);
    harness = await createRelayE2eHarness({ certificates, apiV1: api });
    const first = await harness.connect(["cmd.pause"]);

    harness.commandDelivery.start();
    const initial = await first.next("command");
    first.terminate();
    await eventually(() => expect(harness?.registry.size).toBe(0));
    await eventually(() => expect(harness?.commandDelivery.activeCount).toBe(0));
    expect(api.resultWrites).toEqual([]);

    api.claimBatches.push([claimed("command-reconnect", { claim_token: "claim-command-reconnect-2", generation: 2, attempt_count: 2 })]);
    const second = await harness.connect(["cmd.pause"]);
    await harness.commandDelivery.claimOnce();
    const duplicate = await second.next("command");
    expect(duplicate).toMatchObject({ command_id: initial.command_id, command_seq: initial.command_seq });

    const result = { type: "command_result", device_id: duplicate.device_id, command_id: duplicate.command_id, command_seq: duplicate.command_seq, outcome: "executed" } as const;
    second.send(result);
    second.send(result);
    await eventually(() => expect(api.resultWrites).toEqual([{ commandId: duplicate.command_id, status: "executed", claimToken: "claim-command-reconnect-2", generation: 2 }]));
  });
});
