import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../../db/client.ts";
import { DeviceCommandRelayRepository } from "./device-command-relay.repository.ts";

const ENABLED = Boolean(process.env.DATABASE_URL) && process.env.RELAY_CRASH_RESTART_INTEGRATION_TEST === "1";
const CHILD_PATH = fileURLToPath(new URL("./relay-crash-claim.child.ts", import.meta.url));

interface ChildClaim {
  readonly commandId: string;
  readonly commandSeq: number;
  readonly claimOwner: string;
  readonly claimToken: string;
  readonly generation: number;
  readonly attemptCount: number;
}

interface CommandFenceRow {
  readonly status: string;
  readonly claim_owner: string;
  readonly claim_token: string;
  readonly generation: string;
  readonly attempt_count: number;
  readonly terminal_error_code: string | null;
}

let child: ChildProcess | undefined;
let userId: string;
let deviceId: string;
let commandId: string;

function waitForClaim(processA: ChildProcess): Promise<ChildClaim> {
  return new Promise((resolve, reject) => {
    const stderr: Buffer[] = [];
    processA.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    processA.once("error", reject);
    processA.once("exit", (code, signal) => {
      reject(new Error(`relay process A exited before claim (code=${String(code)}, signal=${String(signal)}): ${Buffer.concat(stderr).toString("utf8")}`));
    });
    processA.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null || !("type" in message) || message.type !== "claimed" || !("claim" in message)) return;
      resolve(message.claim as ChildClaim);
    });
  });
}

function killAndWait(processA: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    processA.once("error", reject);
    processA.once("exit", (_code, signal) => {
      if (signal === "SIGKILL") resolve();
      else reject(new Error(`relay process A did not exit from SIGKILL (signal=${String(signal)})`));
    });
    if (!processA.kill("SIGKILL")) reject(new Error("failed to send SIGKILL to relay process A"));
  });
}

async function readFence(): Promise<CommandFenceRow> {
  const result = await pool.query<CommandFenceRow>(
    `select status,claim_owner,claim_token,generation::text,attempt_count,terminal_error_code
       from device_commands where id=$1`,
    [commandId],
  );
  return result.rows[0]!;
}

describe.skipIf(!ENABLED)("relay crash/restart PostgreSQL fencing", () => {
  beforeEach(async () => {
    userId = randomUUID();
    deviceId = randomUUID();
    commandId = randomUUID();
    await pool.query("insert into users(id,username) values($1,$2)", [userId, `relay-crash-${userId}`]);
    await pool.query(
      `insert into user_printers(id,user_id,brand,model,link_source)
       values($1,$2,'Test','Crash fencing','manual')`,
      [deviceId, userId],
    );
    await pool.query(
      `insert into device_commands(
         id,device_id,device_scope,actor_scope,command,command_seq,payload,max_attempts,
         lease_timeout_seconds,created_at,expires_at
       ) values($1,$2,$2,$3,'pause',1,'{}'::jsonb,3,30,now(),now()+interval '1 hour')`,
      [commandId, deviceId, userId],
    );
  });

  afterEach(async () => {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    child = undefined;
    await pool.query("delete from device_commands where id=$1", [commandId]);
    await pool.query("delete from user_printers where id=$1", [deviceId]);
    await pool.query("delete from users where id=$1", [userId]);
  });

  it("reclaims an abandoned lease after SIGKILL and fences every late write from the dead process", async () => {
    child = fork(CHILD_PATH, [], {
      cwd: process.cwd(),
      execArgv: ["--import", "tsx"],
      env: {
        ...process.env,
        RELAY_CRASH_TEST_DEVICE_ID: deviceId,
        RELAY_CRASH_TEST_CLAIM_OWNER: "relay-process-a",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });

    const original = await waitForClaim(child);
    expect(original).toMatchObject({ commandId, commandSeq: 1, claimOwner: "relay-process-a", generation: 1, attemptCount: 1 });

    await killAndWait(child);
    child = undefined;

    const abandoned = await readFence();
    expect(abandoned).toMatchObject({
      status: "leased",
      claim_owner: original.claimOwner,
      claim_token: original.claimToken,
      generation: String(original.generation),
      attempt_count: 1,
    });

    await pool.query(
      `update device_commands
          set lease_expires_at=clock_timestamp()-interval '1 millisecond'
        where id=$1 and claim_owner=$2 and claim_token=$3 and generation=$4 and status='leased'`,
      [commandId, original.claimOwner, original.claimToken, original.generation],
    );

    const processB = new DeviceCommandRelayRepository(pool);
    const reclaimed = (await processB.claim({ claimOwner: "relay-process-b", authorizedDeviceIds: [deviceId], limit: 1 })).commands[0]!;
    expect(reclaimed).toMatchObject({ commandId, commandSeq: 1, claimOwner: "relay-process-b", generation: original.generation + 1, attemptCount: 2 });
    expect(reclaimed.claimToken).not.toBe(original.claimToken);

    const afterReclaim = await readFence();
    expect(
      await processB.heartbeat({
        commandId,
        claimOwner: original.claimOwner,
        claimToken: original.claimToken,
        generation: original.generation,
        deliveryState: "acknowledged",
      }),
    ).toBeNull();
    expect(
      await processB.writeResult({
        commandId,
        commandSeq: original.commandSeq,
        claimOwner: original.claimOwner,
        claimToken: original.claimToken,
        generation: original.generation,
        status: "failed",
        errorCode: "relay_process_a_late_result",
      }),
    ).toEqual({ kind: "fence_rejected" });
    expect(await readFence()).toEqual(afterReclaim);

    const terminalInput = {
      commandId,
      commandSeq: reclaimed.commandSeq,
      claimOwner: reclaimed.claimOwner,
      claimToken: reclaimed.claimToken,
      generation: reclaimed.generation,
      status: "executed" as const,
      errorCode: null,
    };
    const accepted = await processB.writeResult(terminalInput);
    expect(accepted).toMatchObject({ kind: "accepted", row: { commandId, commandSeq: 1, status: "executed", generation: reclaimed.generation } });
    expect(await processB.writeResult(terminalInput)).toMatchObject({ kind: "replayed", row: { commandId, status: "executed", generation: reclaimed.generation } });
    expect(await readFence()).toMatchObject({
      status: "executed",
      claim_owner: reclaimed.claimOwner,
      claim_token: reclaimed.claimToken,
      generation: String(reclaimed.generation),
      attempt_count: 2,
      terminal_error_code: null,
    });
  });
});
