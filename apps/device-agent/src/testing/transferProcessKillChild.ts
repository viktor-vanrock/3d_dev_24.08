import { readFile, writeFile } from "node:fs/promises";
import type { PrinterDriver, UploadResult } from "../driver/printerDriver.ts";
import { FileTransferHandler } from "../relay/fileTransfer.ts";
import { TransferSpoolRepository, type PersistenceBoundary } from "../relay/transferSpoolRepository.ts";

const [mode, directory, boundary] = process.argv.slice(2) as ["boundary" | "upload" | "start", string, PersistenceBoundary?];
const sideEffectsPath = `${directory}/side-effects.json`;
let armed = false;

const repository = new TransferSpoolRepository(directory, {
  onBoundary: (current) => {
    if (mode === "boundary" && armed && current === boundary) process.kill(process.pid, "SIGKILL");
  },
});

const driver: PrinterDriver = {
  firmwareClass: "process-kill",
  connect: async () => undefined,
  disconnect: async () => undefined,
  capabilities: async () => ({ camera: false, heatedBed: false, heatedChamber: false, multiExtruder: false, supportedCommands: ["start"], raw: {} }),
  status: async () => ({ status: "ready", nozzleTempC: null, bedTempC: null, chamberTempC: null, progress: null, jobId: null, jobFileName: null, raw: {} }),
  pause: async () => ({ ok: false, error: "unused" }),
  resume: async () => ({ ok: false, error: "unused" }),
  cancel: async () => ({ ok: false, error: "unused" }),
  startPrint: async (fileName) => {
    const effects = await readEffects();
    await writeFile(sideEffectsPath, JSON.stringify({ ...effects, starts: effects.starts + 1, currentJob: fileName }));
    if (mode === "start") process.kill(process.pid, "SIGKILL");
    return { ok: true };
  },
  uploadGcode: async () => ({ ok: false, error: "unused" }),
  uploadGcodeStream: async (input): Promise<UploadResult> => {
    const chunks: Buffer[] = [];
    for await (const chunk of input.data) chunks.push(Buffer.from(chunk));
    const effects = await readEffects();
    await writeFile(sideEffectsPath, JSON.stringify({ ...effects, uploads: effects.uploads + 1, remoteFile: input.fileName, remoteBytes: Buffer.concat(chunks).toString("base64") }));
    if (mode === "upload") process.kill(process.pid, "SIGKILL");
    return { ok: true, storedAs: `gcodes/${input.fileName}` };
  },
  camera: async () => null,
  onStatusUpdate: () => () => undefined,
};

const handler = new FileTransferHandler(driver, "device-1", directory, { repository });
const startPrint = mode === "start";
await handler.start({
  type: "file_start", device_id: "device-1", transfer_id: "process-kill", file_name: "kill.gcode", size_bytes: 5,
  sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", object_version: "version-1",
  kind: "gcode", start_print: startPrint, chunk_size_bytes: 65_536,
});
armed = true;
await handler.chunk({ type: "file_chunk", device_id: "device-1", transfer_id: "process-kill", seq: 0, offset_bytes: 0, last: mode !== "boundary", data_base64: "aGVsbG8=" });
throw new Error("hostile child was expected to be killed");

async function readEffects(): Promise<{ uploads: number; starts: number; currentJob: string | null; remoteFile: string | null; remoteBytes: string | null }> {
  try {
    return JSON.parse(await readFile(sideEffectsPath, "utf8")) as { uploads: number; starts: number; currentJob: string | null; remoteFile: string | null; remoteBytes: string | null };
  } catch {
    return { uploads: 0, starts: 0, currentJob: null, remoteFile: null, remoteBytes: null };
  }
}
