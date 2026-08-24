import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CameraInfo,
  CommandResult,
  DriverCapabilities,
  PrinterCommand,
  PrinterDriver,
  PrinterStatusSnapshot,
  StatusUpdateListener,
  UploadGcodeInput,
  UploadResult,
} from "../driver/printerDriver.ts";
import { CommandHandler } from "./commandHandler.ts";
import { FileCommandTerminalLedger } from "./commandTerminalLedger.ts";
import type { CommandFrame } from "./protocol.ts";

const DEVICE_ID = "device-1";
let signingKey: KeyLike;

class FakeDriver implements PrinterDriver {
  readonly firmwareClass = "fake";
  supportedCommands: PrinterCommand[] = ["pause", "resume", "cancel"];
  pauseCalls = 0;
  resumeCalls = 0;
  cancelCalls = 0;
  startCalls: string[] = [];
  nextResult: CommandResult = { ok: true };

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async capabilities(): Promise<DriverCapabilities> {
    return {
      camera: false,
      heatedBed: false,
      heatedChamber: false,
      multiExtruder: false,
      supportedCommands: this.supportedCommands,
      raw: {},
    };
  }
  async status(): Promise<PrinterStatusSnapshot> {
    return {
      status: "printing",
      nozzleTempC: null,
      bedTempC: null,
      chamberTempC: null,
      progress: null,
      jobId: null,
      jobFileName: null,
      raw: {},
    };
  }
  async pause(): Promise<CommandResult> {
    this.pauseCalls++;
    return this.nextResult;
  }
  async resume(): Promise<CommandResult> {
    this.resumeCalls++;
    return this.nextResult;
  }
  async cancel(): Promise<CommandResult> {
    this.cancelCalls++;
    return this.nextResult;
  }
  async uploadGcode(_input: UploadGcodeInput): Promise<UploadResult> {
    return { ok: true };
  }
  async startPrint(fileName: string): Promise<CommandResult> {
    this.startCalls.push(fileName);
    return this.nextResult;
  }
  async camera(): Promise<CameraInfo | null> {
    return null;
  }
  onStatusUpdate(_listener: StatusUpdateListener): () => void {
    return () => {};
  }
}

async function makeToken(opts: { deviceId?: string; command?: string; role?: string; jti?: string; ownerId?: string; expiredAgo?: string }): Promise<string> {
  const commandId = opts.jti ?? "cmd-1";
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    typ: "command",
    gateway_id: DEVICE_ID,
    command_id: commandId,
    owner_id: opts.ownerId ?? "owner-1",
    device_id: opts.deviceId ?? DEVICE_ID,
    role: opts.role ?? "owner",
    command: opts.command ?? "pause",
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setIssuer("portal-api").setAudience("portal-device-agent")
    .setJti(commandId).setIssuedAt(now).setNotBefore(now)
    .setExpirationTime(opts.expiredAgo ? now - 1 : now + 60)
    .sign(signingKey);
}

function frame(
  overrides: {
    device_id?: string;
    command_id?: string;
    command_seq?: number;
    command?: PrinterCommand;
    command_token?: string;
    payload?: { file_name: string };
  } = {},
): CommandFrame {
  const common = {
    type: "command" as const,
    device_id: overrides.device_id ?? DEVICE_ID,
    command_id: overrides.command_id ?? "cmd-1",
    command_seq: overrides.command_seq ?? 1,
    command_token: overrides.command_token ?? "placeholder",
  };
  if (overrides.command === "start")
    return {
      ...common,
      command: "start",
      payload: overrides.payload ?? { file_name: "print.gcode" },
    };
  return { ...common, command: overrides.command ?? "pause", payload: {} };
}

describe("CommandHandler", () => {
  beforeAll(async () => {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    signingKey = pair.privateKey;
    const publicJwk = await exportJWK(pair.publicKey);
    process.env.COMMAND_VERIFICATION_KEYS = JSON.stringify({
      version: "device-agent-runtime.v1", issuer: "portal-api", audience: "portal-device-agent",
      keys: [{ kid: "test-key", alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: publicJwk.x }],
    });
  });
  afterAll(() => {
    delete process.env.COMMAND_VERIFICATION_KEYS;
  });

  it("executes a valid owner-signed pause and acks", async () => {
    const driver = new FakeDriver();
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({});
    const result = await handler.handle(frame({ command_token: token }));
    expect(result).toEqual({
      type: "command_result",
      device_id: DEVICE_ID,
      command_id: "cmd-1",
      command_seq: 1,
      outcome: "executed",
    });
    expect(driver.pauseCalls).toBe(1);
  });

  it("revalidates lifecycle admission after token verification and before the driver", async () => {
    const driver = new FakeDriver();
    let status: "healthy" | "degraded" = "healthy";
    const handler = new CommandHandler(
      driver,
      DEVICE_ID,
      () => status,
      () => {},
      undefined,
      async () => {
        status = "degraded";
        return { ownerId: "owner-1", deviceId: DEVICE_ID, role: "owner", command: "pause", commandId: "cmd-1", nonce: "nonce-1" };
      },
    );

    await expect(handler.handle(frame())).resolves.toMatchObject({ outcome: "failed", error_code: "device_unavailable" });
    expect(driver.pauseCalls).toBe(0);
  });

  it("rejects a viewer role even with a structurally valid token", async () => {
    const driver = new FakeDriver();
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({ role: "viewer" });
    const result = await handler.handle(frame({ command_token: token }));
    expect(result).toMatchObject({
      type: "command_result",
      outcome: "failed",
      error_code: "role_not_allowed",
    });
    expect(driver.pauseCalls).toBe(0);
  });

  it("rejects a command not in DriverCapabilities.supportedCommands", async () => {
    const driver = new FakeDriver();
    driver.supportedCommands = ["resume", "cancel"];
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({});
    const result = await handler.handle(frame({ command_token: token }));
    expect(result).toMatchObject({
      type: "command_result",
      outcome: "failed",
      error_code: "command_not_supported",
    });
    expect(driver.pauseCalls).toBe(0);
  });

  it("is idempotent: replaying the same commandId+seq does not re-invoke the driver", async () => {
    const driver = new FakeDriver();
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({});
    const f = frame({ command_token: token });
    const first = await handler.handle(f);
    const second = await handler.handle(f); // reconnect retry, same frame
    expect(second).toEqual(first);
    expect(driver.pauseCalls).toBe(1);
  });

  it("reuses a terminal result after process restart without re-invoking the driver", async () => {
    const directory = mkdtempSync(join(tmpdir(), "command-handler-ledger-"));
    try {
      const ledgerPath = join(directory, "ledger.json");
      const driver = new FakeDriver();
      const token = await makeToken({});
      const command = frame({ command_token: token });

      const first = await new CommandHandler(
        driver,
        DEVICE_ID,
        () => "healthy",
        () => {},
        new FileCommandTerminalLedger(ledgerPath),
      ).handle(command);
      const afterRestart = await new CommandHandler(
        driver,
        DEVICE_ID,
        () => "healthy",
        () => {},
        new FileCommandTerminalLedger(ledgerPath),
      ).handle(command);

      expect(afterRestart).toEqual(first);
      expect(driver.pauseCalls).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("coalesces concurrent delivery of the same commandId+seq", async () => {
    const driver = new FakeDriver();
    let release: (() => void) | undefined;
    driver.pause = async () => {
      driver.pauseCalls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true };
    };
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({});
    const command = frame({ command_token: token });

    const first = handler.handle(command);
    const second = handler.handle(command);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release!();

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        type: "command_result",
        device_id: DEVICE_ID,
        command_id: "cmd-1",
        command_seq: 1,
        outcome: "executed",
      },
      {
        type: "command_result",
        device_id: DEVICE_ID,
        command_id: "cmd-1",
        command_seq: 1,
        outcome: "executed",
      },
    ]);
    expect(driver.pauseCalls).toBe(1);
  });

  it("closes admission and bounds shutdown while a hardware operation is active", async () => {
    const driver = new FakeDriver();
    let release: (() => void) | undefined;
    driver.pause = async () => {
      driver.pauseCalls++;
      await new Promise<void>((resolve) => { release = resolve; });
      return { ok: true };
    };
    const handler = new CommandHandler(driver, DEVICE_ID);
    const running = handler.handle(frame({ command_token: await makeToken({}) }));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    await expect(handler.shutdown(5)).resolves.toBe(false);
    await expect(handler.handle(frame({ command_id: "cmd-2", command_seq: 2 }))).resolves.toMatchObject({ outcome: "failed", error_code: "device_unavailable" });
    release?.();
    await running;
    await expect(handler.shutdown(50)).resolves.toBe(true);
    expect(driver.pauseCalls).toBe(1);
  });

  it("rejects a replayed/stale seq for a new commandId", async () => {
    const driver = new FakeDriver();
    const handler = new CommandHandler(driver, DEVICE_ID);
    const tokenA = await makeToken({ jti: "cmd-1" });
    await handler.handle(frame({ command_token: tokenA, command_id: "cmd-1", command_seq: 5 }));

    const tokenB = await makeToken({ jti: "cmd-2" });
    const result = await handler.handle(frame({ command_token: tokenB, command_id: "cmd-2", command_seq: 5 }));
    expect(result).toMatchObject({
      type: "command_result",
      outcome: "failed",
      error_code: "replay_rejected",
    });
    expect(driver.pauseCalls).toBe(1);
  });

  it("rejects an expired token", async () => {
    const driver = new FakeDriver();
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({ expiredAgo: "yes" });
    const result = await handler.handle(frame({ command_token: token }));
    expect(result).toMatchObject({
      type: "command_result",
      outcome: "failed",
      error_code: "invalid_command_token",
    });
    expect(driver.pauseCalls).toBe(0);
  });

  it("rejects a token whose command claim doesn't match the frame's command", async () => {
    const driver = new FakeDriver();
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({ command: "cancel" });
    const result = await handler.handle(frame({ command_token: token, command: "pause" }));
    expect(result).toMatchObject({
      type: "command_result",
      outcome: "failed",
      error_code: "invalid_command_token",
    });
    expect(driver.pauseCalls).toBe(0);
    expect(driver.cancelCalls).toBe(0);
  });

  it("surfaces an explicit driver failure as a failed command_result", async () => {
    const driver = new FakeDriver();
    driver.nextResult = { ok: false, error: "printer offline" };
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({});
    const result = await handler.handle(frame({ command_token: token }));
    expect(result).toMatchObject({
      type: "command_result",
      outcome: "failed",
      error_code: "command_failed",
      message: "printer offline",
    });
  });

  // MF-1975: "start" печатает уже доставленный (file-ingress/kind=gcode) файл — fileName
  // приходит на кадре, не через driver.pause()-стиля zero-arg вызов.
  it("executes start with the delivered fileName and acks", async () => {
    const driver = new FakeDriver();
    driver.supportedCommands = ["pause", "resume", "cancel", "start"];
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({ command: "start" });
    const result = await handler.handle(
      frame({
        command_token: token,
        command: "start",
        payload: { file_name: "print-request-1.gcode" },
      }),
    );
    expect(result).toEqual({
      type: "command_result",
      device_id: DEVICE_ID,
      command_id: "cmd-1",
      command_seq: 1,
      outcome: "executed",
    });
    expect(driver.startCalls).toEqual(["print-request-1.gcode"]);
  });

  it("surfaces startPrint driver failure as a failed command_result", async () => {
    const driver = new FakeDriver();
    driver.supportedCommands = ["pause", "resume", "cancel", "start"];
    driver.nextResult = { ok: false, error: "moonraker rejected start" };
    const handler = new CommandHandler(driver, DEVICE_ID);
    const token = await makeToken({ command: "start" });
    const result = await handler.handle(
      frame({
        command_token: token,
        command: "start",
        payload: { file_name: "print-request-1.gcode" },
      }),
    );
    expect(result).toMatchObject({
      type: "command_result",
      outcome: "failed",
      error_code: "command_failed",
      message: "moonraker rejected start",
    });
  });
});
