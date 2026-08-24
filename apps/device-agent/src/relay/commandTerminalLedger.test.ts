import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandLedgerCorruptError, FileCommandTerminalLedger } from "./commandTerminalLedger.ts";

describe("FileCommandTerminalLedger", () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "command-terminal-ledger-"));
    path = join(directory, "ledger.json");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const executed = (commandId: string, commandSeq: number) => ({
    type: "command_result" as const,
    device_id: "device-1",
    command_id: commandId,
    command_seq: commandSeq,
    outcome: "executed" as const,
  });

  it("persists terminal results and sequence high-water state across instances", () => {
    const ledger = new FileCommandTerminalLedger(path);
    ledger.acceptSequence("device-1", 7);
    ledger.record({
      deviceId: "device-1",
      commandId: "command-7",
      sequence: 7,
      result: executed("command-7", 7),
    });

    const restarted = new FileCommandTerminalLedger(path);
    expect(restarted.lastSequence("device-1")).toBe(7);
    expect(restarted.lookup("device-1", "command-7", 7)).toEqual({
      status: "match",
      result: executed("command-7", 7),
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("fails closed when a command id is reused with another sequence or device", () => {
    const ledger = new FileCommandTerminalLedger(path);
    ledger.record({
      deviceId: "device-1",
      commandId: "command-1",
      sequence: 1,
      result: {
        type: "command_result",
        device_id: "device-1",
        command_id: "command-1",
        command_seq: 1,
        outcome: "failed",
        error_code: "command_failed",
      },
    });

    expect(ledger.lookup("device-1", "command-1", 2)).toEqual({
      status: "conflict",
    });
    expect(ledger.lookup("device-2", "command-1", 1)).toEqual({
      status: "conflict",
    });
    expect(() =>
      ledger.record({
        deviceId: "device-1",
        commandId: "command-1",
        sequence: 1,
        result: executed("command-1", 1),
      }),
    ).toThrow("command terminal ledger result conflict");
  });

  it("retains only the configured number of results while preserving sequence high-water state", () => {
    const ledger = new FileCommandTerminalLedger(path, 2);
    for (let sequence = 1; sequence <= 3; sequence++) {
      ledger.acceptSequence("device-1", sequence);
      ledger.record({
        deviceId: "device-1",
        commandId: `command-${sequence}`,
        sequence,
        result: executed(`command-${sequence}`, sequence),
      });
    }

    const document = JSON.parse(readFileSync(path, "utf8")) as {
      entries: Array<{ commandId: string }>;
    };
    expect(document.entries.map((entry) => entry.commandId)).toEqual(["command-2", "command-3"]);
    const restarted = new FileCommandTerminalLedger(path, 2);
    expect(restarted.lookup("device-1", "command-1", 1)).toEqual({
      status: "missing",
    });
    expect(restarted.lastSequence("device-1")).toBe(3);
  });

  it("rejects corrupt or structurally invalid state instead of resetting it", () => {
    writeFileSync(path, '{"version":1,"lastSequenceByDevice":{},"entries":[', {
      mode: 0o600,
    });
    expect(() => new FileCommandTerminalLedger(path)).toThrow(CommandLedgerCorruptError);

    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        lastSequenceByDevice: { "device-1": "7" },
        entries: [],
      }),
      { mode: 0o600 },
    );
    expect(() => new FileCommandTerminalLedger(path)).toThrow(CommandLedgerCorruptError);
  });
});
