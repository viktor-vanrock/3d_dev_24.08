import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { PrinterDriver } from "../driver/printerDriver.ts";
import { FileTransferHandler } from "./fileTransfer.ts";
import type { PersistenceBoundary } from "./transferSpoolRepository.ts";

const child = fileURLToPath(new URL("../testing/transferProcessKillChild.ts", import.meta.url));
const boundaries: readonly PersistenceBoundary[] = ["data_written", "data_synced", "temp_state_written", "temp_state_synced", "state_renamed", "directory_synced"];
let directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories = [];
});

describe("hostile transfer process-kill recovery", () => {
  it.each(boundaries)("durably resumes after SIGKILL at %s", async (boundary) => {
    const directory = await temporaryDirectory();
    expect(killChild("boundary", directory, boundary)).toBe("SIGKILL");
    const handler = new FileTransferHandler(recoveryDriver(), "device-1", directory);
    const resumed = await handler.start(start(false));
    const committed = boundary === "state_renamed" || boundary === "directory_synced";
    expect(resumed).toMatchObject({ next_seq: committed ? 1 : 0, next_offset_bytes: committed ? 5 : 0 });
    expect((await readFile(join(directory, "process-kill.part"))).byteLength).toBe(committed ? 5 : 0);
  });

  it("reconciles a killed upload without repeating the external side effect", async () => {
    const directory = await temporaryDirectory();
    expect(killChild("upload", directory)).toBe("SIGKILL");
    const effects = await readEffects(directory);
    const driver = recoveryDriver();
    const handler = new FileTransferHandler(driver, "device-1", directory, {
      reconcileUpload: async () => ({ status: "present", storedAs: `gcodes/${effects.remoteFile!}`, sizeBytes: 5, sha256: createHash("sha256").update(Buffer.from(effects.remoteBytes!, "base64")).digest("hex") }),
    });
    await expect(handler.start(start(false))).resolves.toMatchObject({ outcome: "stored" });
    expect((await readEffects(directory)).uploads).toBe(1);
  });

  it("reconciles a killed start-print without repeating the hardware side effect", async () => {
    const directory = await temporaryDirectory();
    expect(killChild("start", directory)).toBe("SIGKILL");
    const effects = await readEffects(directory);
    const driver = recoveryDriver(effects.currentJob);
    const handler = new FileTransferHandler(driver, "device-1", directory);
    await expect(handler.start(start(true))).resolves.toMatchObject({ outcome: "stored" });
    expect((await readEffects(directory)).starts).toBe(1);
  });
});

function killChild(mode: "boundary" | "upload" | "start", directory: string, boundary?: PersistenceBoundary): NodeJS.Signals | null {
  return spawnSync(process.execPath, ["--import", "tsx", child, mode, directory, ...(boundary ? [boundary] : [])], { cwd: process.cwd(), timeout: 10_000 }).signal;
}

function start(startPrint: boolean) {
  return { type: "file_start", device_id: "device-1", transfer_id: "process-kill", file_name: "kill.gcode", size_bytes: 5,
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", object_version: "version-1", kind: "gcode", start_print: startPrint, chunk_size_bytes: 65_536 } as const;
}

function recoveryDriver(currentJob: string | null = null): PrinterDriver {
  return { firmwareClass: "recovery", connect: async () => undefined, disconnect: async () => undefined,
    capabilities: async () => ({ camera: false, heatedBed: false, heatedChamber: false, multiExtruder: false, supportedCommands: ["start"], raw: {} }),
    status: async () => ({ status: currentJob ? "printing" : "ready", nozzleTempC: null, bedTempC: null, chamberTempC: null, progress: null, jobId: null, jobFileName: currentJob, raw: {} }),
    pause: async () => ({ ok: false, error: "unexpected" }), resume: async () => ({ ok: false, error: "unexpected" }), cancel: async () => ({ ok: false, error: "unexpected" }),
    startPrint: async () => { throw new Error("start side effect repeated"); }, uploadGcode: async () => ({ ok: false, error: "unexpected" }),
    uploadGcodeStream: async () => { throw new Error("upload side effect repeated"); }, camera: async () => null, onStatusUpdate: () => () => undefined };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "portal-process-kill-"));
  directories.push(directory);
  return directory;
}

async function readEffects(directory: string): Promise<{ uploads: number; starts: number; currentJob: string | null; remoteFile: string | null; remoteBytes: string | null }> {
  return JSON.parse(await readFile(join(directory, "side-effects.json"), "utf8")) as { uploads: number; starts: number; currentJob: string | null; remoteFile: string | null; remoteBytes: string | null };
}
