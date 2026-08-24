import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../../db/client.ts";
import { DeviceCommandRelayRepository } from "./device-command-relay.repository.ts";

const ENABLED = Boolean(process.env.DATABASE_URL) && process.env.DEVICE_COMMAND_RELAY_INTEGRATION_TEST === "1";
const repository = new DeviceCommandRelayRepository(pool);
let userId: string;
let firstDeviceId: string;
let secondDeviceId: string;

async function queue(input: {
  readonly deviceId: string;
  readonly sequence: number;
  readonly command?: "start" | "pause" | "resume" | "cancel";
  readonly maxAttempts?: number;
  readonly leaseTimeoutSeconds?: number;
  readonly createdAt?: Date;
  readonly expiresAt?: Date;
}): Promise<string> {
  const command = input.command ?? "pause";
  const result = await pool.query<{ id: string }>(
    `insert into device_commands(
       device_id,device_scope,actor_scope,command,command_seq,payload,max_attempts,
       lease_timeout_seconds,created_at,expires_at
     ) values($1,$1,$2,$3,$4,$5,$6,$7,coalesce($8,now()),coalesce($9,now()+interval '1 hour'))
     returning id`,
    [
      input.deviceId,
      userId,
      command,
      input.sequence,
      command === "start" ? { file_name: `job-${input.sequence}.gcode` } : {},
      input.maxAttempts ?? 3,
      input.leaseTimeoutSeconds ?? 30,
      input.createdAt ?? null,
      input.expiresAt ?? null,
    ],
  );
  return result.rows[0]!.id;
}

describe.skipIf(!ENABLED)("DeviceCommandRelayRepository PostgreSQL leasing", () => {
  beforeEach(async () => {
    userId = randomUUID();
    firstDeviceId = randomUUID();
    secondDeviceId = randomUUID();
    await pool.query("insert into users(id,username) values($1,$2)", [userId, `relay-claim-${userId}`]);
    await pool.query(
      `insert into user_printers(id,user_id,brand,model,link_source)
       values($1,$3,'Test','Relay A','manual'),($2,$3,'Test','Relay B','manual')`,
      [firstDeviceId, secondDeviceId, userId],
    );
  });

  afterEach(async () => {
    await pool.query("delete from device_commands where device_id=any($1::uuid[])", [[firstDeviceId, secondDeviceId]]);
    await pool.query("delete from user_printers where id=any($1::uuid[])", [[firstDeviceId, secondDeviceId]]);
    await pool.query("delete from users where id=$1", [userId]);
  });

  it("serializes parallel claims per device and releases the next sequence only after terminal completion", async () => {
    await queue({ deviceId: firstDeviceId, sequence: 1 });
    await queue({ deviceId: firstDeviceId, sequence: 2 });

    const [firstAttempt, secondAttempt] = await Promise.all([
      repository.claim({ claimOwner: "relay-a", authorizedDeviceIds: [firstDeviceId], limit: 10 }),
      repository.claim({ claimOwner: "relay-b", authorizedDeviceIds: [firstDeviceId], limit: 10 }),
    ]);
    const claimed = [...firstAttempt.commands, ...secondAttempt.commands];
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.commandSeq).toBe(1);
    expect(claimed[0]?.attemptCount).toBe(1);

    const current = claimed[0]!;
    const completed = await repository.writeResult({
      commandId: current.commandId,
      commandSeq: current.commandSeq,
      claimOwner: current.claimOwner,
      claimToken: current.claimToken,
      generation: current.generation,
      status: "executed",
      errorCode: null,
    });
    expect(completed.kind).toBe("accepted");
    const next = await repository.claim({ claimOwner: "relay-c", authorizedDeviceIds: [firstDeviceId], limit: 10 });
    expect(next.commands.map(({ commandSeq }) => commandSeq)).toEqual([2]);
  });

  it("claims commands for different devices concurrently", async () => {
    await queue({ deviceId: firstDeviceId, sequence: 1 });
    await queue({ deviceId: secondDeviceId, sequence: 1 });

    const [first, second] = await Promise.all([
      repository.claim({ claimOwner: "relay-a", authorizedDeviceIds: [firstDeviceId], limit: 1 }),
      repository.claim({ claimOwner: "relay-b", authorizedDeviceIds: [secondDeviceId], limit: 1 }),
    ]);
    expect(new Set([...first.commands, ...second.commands].map(({ deviceId }) => deviceId))).toEqual(new Set([firstDeviceId, secondDeviceId]));
  });

  it("reclaims an expired lease with a newer fence and rejects stale heartbeat/result", async () => {
    await queue({ deviceId: firstDeviceId, sequence: 1, maxAttempts: 3 });
    const original = (await repository.claim({ claimOwner: "relay-old", authorizedDeviceIds: [firstDeviceId], limit: 1 })).commands[0]!;
    await pool.query("update device_commands set lease_expires_at=now()-interval '1 second' where id=$1", [original.commandId]);

    const reclaimed = (await repository.claim({ claimOwner: "relay-new", authorizedDeviceIds: [firstDeviceId], limit: 1 })).commands[0]!;
    expect(reclaimed.attemptCount).toBe(2);
    expect(reclaimed.generation).toBe(original.generation + 1);
    expect(reclaimed.claimToken).not.toBe(original.claimToken);
    expect(
      await repository.heartbeat({
        commandId: original.commandId,
        claimOwner: original.claimOwner,
        claimToken: original.claimToken,
        generation: original.generation,
        deliveryState: "delivered",
      }),
    ).toBeNull();
    expect(
      await repository.writeResult({
        commandId: original.commandId,
        commandSeq: original.commandSeq,
        claimOwner: original.claimOwner,
        claimToken: original.claimToken,
        generation: original.generation,
        status: "executed",
        errorCode: null,
      }),
    ).toEqual({ kind: "fence_rejected" });

    const heartbeat = await repository.heartbeat({
      commandId: reclaimed.commandId,
      claimOwner: reclaimed.claimOwner,
      claimToken: reclaimed.claimToken,
      generation: reclaimed.generation,
      deliveryState: "acknowledged",
    });
    expect(heartbeat?.status).toBe("acknowledged");
    const terminalInput = {
      commandId: reclaimed.commandId,
      commandSeq: reclaimed.commandSeq,
      claimOwner: reclaimed.claimOwner,
      claimToken: reclaimed.claimToken,
      generation: reclaimed.generation,
      status: "executed" as const,
      errorCode: null,
    };
    expect((await repository.writeResult(terminalInput)).kind).toBe("accepted");
    expect((await repository.writeResult(terminalInput)).kind).toBe("replayed");
    expect((await repository.writeResult({ ...terminalInput, status: "failed", errorCode: "command_failed" })).kind).toBe("conflict");
  });

  it("terminates exhausted and absolutely expired commands without reclaiming them", async () => {
    const exhaustedId = await queue({ deviceId: firstDeviceId, sequence: 1, maxAttempts: 1 });
    const exhausted = (await repository.claim({ claimOwner: "relay-old", authorizedDeviceIds: [firstDeviceId], limit: 1 })).commands[0]!;
    await pool.query("update device_commands set lease_expires_at=now()-interval '1 second' where id=$1", [exhausted.commandId]);
    expect((await repository.claim({ claimOwner: "relay-new", authorizedDeviceIds: [firstDeviceId], limit: 1 })).commands).toEqual([]);

    const expiredId = await queue({
      deviceId: secondDeviceId,
      sequence: 1,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    expect((await repository.claim({ claimOwner: "relay-new", authorizedDeviceIds: [secondDeviceId], limit: 1 })).commands).toEqual([]);
    const terminal = await pool.query<{ id: string; status: string; terminal_error_code: string }>(
      "select id,status,terminal_error_code from device_commands where id=any($1::uuid[]) order by id",
      [[exhaustedId, expiredId]],
    );
    expect(new Map(terminal.rows.map((row) => [row.id, [row.status, row.terminal_error_code]]))).toEqual(
      new Map([
        [exhaustedId, ["failed", "attempts_exhausted"]],
        [expiredId, ["expired", "command_expired"]],
      ]),
    );
  });

  it("replays a lost claim response by operation identity and rejects a contradictory retry", async () => {
    await queue({ deviceId: firstDeviceId, sequence: 1 });
    const input = {
      claimOwner: "relay-retry",
      authorizedDeviceIds: [firstDeviceId],
      limit: 1,
      operationId: "claim-operation-retry-1",
      requestHash: "a".repeat(64),
    } as const;
    const accepted = await repository.claim(input);
    const replayed = await repository.claim(input);
    expect(accepted.replayed).toBe(false);
    expect(replayed).toEqual({ ...accepted, replayed: true });
    await expect(repository.claim({ ...input, requestHash: "b".repeat(64) })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
});
