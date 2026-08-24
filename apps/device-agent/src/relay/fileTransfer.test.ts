import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PrinterDriver, UploadResult } from "../driver/printerDriver.ts";
import { FileTransferHandler } from "./fileTransfer.ts";
import type { FileChunkFrame, FileStartFrame } from "./protocol.ts";
import type { PersistenceBoundary } from "./transferSpoolRepository.ts";

class StreamingDriver {
  readonly firmwareClass = "fake";
  uploaded: Uint8Array[] = [];
  started: string[] = [];
  roots: string[] = [];
  uploadCalls = 0;
  statusFileName: string | null = null;

  async uploadGcodeStream(input: { fileName: string; size: number; data: AsyncIterable<Uint8Array>; root?: string }): Promise<UploadResult> {
    this.uploadCalls += 1;
    for await (const chunk of input.data) this.uploaded.push(new Uint8Array(chunk));
    this.roots.push(input.root ?? "gcodes");
    return {
      ok: true,
      storedAs: `${input.root ?? "gcodes"}/${input.fileName}`,
    };
  }

  async startPrint(fileName: string) {
    this.started.push(fileName);
    this.statusFileName = fileName;
    return { ok: true };
  }

  async status() {
    return { status: this.statusFileName ? "printing" : "ready", nozzleTempC: null, bedTempC: null, chamberTempC: null, progress: null, jobId: null, jobFileName: this.statusFileName, raw: {} };
  }
}

function start(overrides: Partial<FileStartFrame> = {}): FileStartFrame {
  return {
    type: "file_start",
    device_id: "device-1",
    transfer_id: "transfer-1",
    file_name: "benchy.gcode",
    size_bytes: 5,
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    object_version: "version-1",
    kind: "gcode",
    start_print: true,
    chunk_size_bytes: 65_536,
    ...overrides,
  };
}

function chunk(seq: number, dataBase64: string, last = false, offsetBytes = seq === 0 ? 0 : 3): FileChunkFrame {
  return {
    type: "file_chunk",
    device_id: "device-1",
    transfer_id: "transfer-1",
    seq,
    offset_bytes: offsetBytes,
    last,
    data_base64: dataBase64,
  };
}

describe("FileTransferHandler", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("writes chunks to disk, resumes duplicate delivery, streams to the driver and starts the job", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory);

    expect(await handler.start(start())).toEqual({
      type: "file_start_ack",
      device_id: "device-1",
      transfer_id: "transfer-1",
      next_seq: 0,
      next_offset_bytes: 0,
    });
    expect(await handler.chunk(chunk(0, "aGVs"))).toEqual({
      type: "file_chunk_ack",
      device_id: "device-1",
      transfer_id: "transfer-1",
      seq: 0,
      next_seq: 1,
      next_offset_bytes: 3,
    });
    expect(await handler.chunk(chunk(0, "aGVs"))).toEqual({
      type: "file_chunk_ack",
      device_id: "device-1",
      transfer_id: "transfer-1",
      seq: 0,
      next_seq: 1,
      next_offset_bytes: 3,
    });
    expect(await handler.chunk(chunk(1, "bG8=", true))).toEqual({
      type: "file_result",
      device_id: "device-1",
      transfer_id: "transfer-1",
      outcome: "stored",
      stored_as: "gcodes/benchy.2cf24dba5fb0a30e.gcode",
    });

    expect(Buffer.concat(driver.uploaded.map((value) => Buffer.from(value))).toString()).toBe("hello");
    expect(driver.started).toEqual(["gcodes/benchy.2cf24dba5fb0a30e.gcode"]);
  });

  it("rejects a gap without corrupting the resumable spool", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const handler = new FileTransferHandler(new StreamingDriver() as unknown as PrinterDriver, "device-1", directory);

    await handler.start(start({ start_print: false }));
    await expect(handler.chunk(chunk(1, "aG", true))).resolves.toEqual({
      type: "file_result",
      device_id: "device-1",
      transfer_id: "transfer-1",
      outcome: "failed",
      error_code: "invalid_sequence",
      next_seq: 0,
      next_offset_bytes: 0,
    });
    expect(await readFile(join(directory, "transfer-1.part"))).toHaveLength(0);
  });

  it("MF-1500 возобновляет незавершённую загрузку после offline→online с тем же transferId", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const firstHandler = new FileTransferHandler(new StreamingDriver() as unknown as PrinterDriver, "device-1", directory);

    await expect(firstHandler.start(start())).resolves.toEqual({
      type: "file_start_ack",
      device_id: "device-1",
      transfer_id: "transfer-1",
      next_seq: 0,
      next_offset_bytes: 0,
    });
    await expect(firstHandler.chunk(chunk(0, "aGVs"))).resolves.toEqual({
      type: "file_chunk_ack",
      device_id: "device-1",
      transfer_id: "transfer-1",
      seq: 0,
      next_seq: 1,
      next_offset_bytes: 3,
    });

    const resumedDriver = new StreamingDriver();
    const resumedHandler = new FileTransferHandler(resumedDriver as unknown as PrinterDriver, "device-1", directory);

    await expect(resumedHandler.start(start())).resolves.toEqual({
      type: "file_start_ack",
      device_id: "device-1",
      transfer_id: "transfer-1",
      next_seq: 1,
      next_offset_bytes: 3,
    });
    await expect(resumedHandler.chunk(chunk(1, "bG8=", true))).resolves.toEqual({
      type: "file_result",
      device_id: "device-1",
      transfer_id: "transfer-1",
      outcome: "stored",
      stored_as: "gcodes/benchy.2cf24dba5fb0a30e.gcode",
    });
    expect(Buffer.concat(resumedDriver.uploaded.map((value) => Buffer.from(value))).toString()).toBe("hello");
  });

  it("MF-1942 отправляет printer_profile в root=config и никогда не стартует печать", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory);

    await expect(
      handler.start(
        start({
          file_name: "profile.ini",
          kind: "printer_profile",
          start_print: true,
        }),
      ),
    ).resolves.toEqual({
      type: "file_start_ack",
      device_id: "device-1",
      transfer_id: "transfer-1",
      next_seq: 0,
      next_offset_bytes: 0,
    });
    await expect(handler.chunk(chunk(0, "aGVs"))).resolves.toEqual({
      type: "file_chunk_ack",
      device_id: "device-1",
      transfer_id: "transfer-1",
      seq: 0,
      next_seq: 1,
      next_offset_bytes: 3,
    });
    await expect(handler.chunk(chunk(1, "bG8=", true))).resolves.toEqual({
      type: "file_result",
      device_id: "device-1",
      transfer_id: "transfer-1",
      outcome: "stored",
      stored_as: "config/profile.2cf24dba5fb0a30e.ini",
    });

    expect(driver.roots).toEqual(["config"]);
    // startPrint=true во входном кадре игнорируется для printer_profile — защита в глубину
    // поверх relay/api-гейтов (device_transfers_profile_kind_no_print, MF-1942).
    expect(driver.started).toEqual([]);
  });

  it("MF-1942 отклоняет printer_profile с .gcode-именем и gcode с .ini-именем", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const handler = new FileTransferHandler(new StreamingDriver() as unknown as PrinterDriver, "device-1", directory);

    await expect(handler.start(start({ file_name: "benchy.gcode", kind: "printer_profile" }))).resolves.toMatchObject({
      type: "file_result",
      transfer_id: "transfer-1",
      outcome: "failed",
      error_code: "invalid_transfer",
    });
    await expect(handler.start(start({ file_name: "profile.ini", kind: "gcode" }))).resolves.toMatchObject({
      type: "file_result",
      transfer_id: "transfer-1",
      outcome: "failed",
      error_code: "invalid_transfer",
    });
  });

  it("rejects an immutable source version change on resume", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const handler = new FileTransferHandler(new StreamingDriver() as unknown as PrinterDriver, "device-1", directory);
    await handler.start(start());
    await handler.chunk(chunk(0, "aGVs"));

    await expect(handler.start(start({ object_version: "version-2" }))).resolves.toMatchObject({
      type: "file_result",
      outcome: "failed",
      error_code: "source_changed",
      next_seq: 1,
      next_offset_bytes: 3,
    });
  });

  it("rejects the wrong device and a changed gateway identity before driver access", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory, { gatewayId: "gateway-1" });
    await expect(handler.start(start({ device_id: "device-2" }))).resolves.toMatchObject({ outcome: "failed", error_code: "device_not_authorized" });
    await handler.start(start());
    const changedGateway = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory, { gatewayId: "gateway-2" });
    await expect(changedGateway.start(start())).resolves.toMatchObject({ outcome: "failed", error_code: "source_changed" });
    expect(driver.uploadCalls).toBe(0);
    expect(driver.started).toEqual([]);
  });

  it("persists a versioned checksummed state and enforces the shared spool-space budget", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const handler = new FileTransferHandler(new StreamingDriver() as unknown as PrinterDriver, "device-1", directory, { maxSpoolBytes: 5 });
    await handler.start(start());
    const persisted = JSON.parse(await readFile(join(directory, "transfer-1.json"), "utf8")) as Record<string, unknown>;
    expect(persisted).toMatchObject({ schemaVersion: 1, committedOffset: 0, nextSequence: 0, phase: "receiving" });
    expect(persisted.metadataHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted.stateChecksumSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(handler.start(start({ transfer_id: "transfer-2" }))).resolves.toMatchObject({ outcome: "failed", error_code: "transfer_timeout", message: "spool_space_budget_exceeded" });
  });

  it("rejects checksum failure without calling the driver and durably replays the failure", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory);

    await handler.start(start({ sha256: "0".repeat(64) }));
    const failed = await handler.chunk(chunk(0, "aGVsbG8=", true, 0));
    expect(failed).toMatchObject({ outcome: "failed", error_code: "checksum_mismatch" });
    expect(driver.uploadCalls).toBe(0);
    expect(driver.started).toEqual([]);

    const restarted = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory);
    await expect(restarted.chunk(chunk(0, "aGVsbG8=", true, 0))).resolves.toEqual(failed);
    expect(driver.uploadCalls).toBe(0);
  });

  it("serializes concurrent chunks for one transfer and invokes each hardware side effect once", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory);
    await handler.start(start());

    const first = handler.chunk(chunk(0, "aGVs"));
    const second = handler.chunk(chunk(1, "bG8=", true));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ type: "file_chunk_ack", next_offset_bytes: 3 }),
      expect.objectContaining({ type: "file_result", outcome: "stored" }),
    ]);
    expect(driver.uploadCalls).toBe(1);
    expect(driver.started).toHaveLength(1);
  });

  it("rejects conflicting duplicate bytes, including after a durable terminal result", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory);
    await handler.start(start());
    await handler.chunk(chunk(0, "aGVs"));
    await expect(handler.chunk(chunk(0, "YmFk"))).resolves.toMatchObject({ outcome: "failed", error_code: "transfer_conflict" });
    await handler.chunk(chunk(1, "bG8=", true));
    await expect(handler.chunk(chunk(1, "eHg=", true))).resolves.toMatchObject({ outcome: "failed", error_code: "transfer_conflict" });
    expect(driver.uploadCalls).toBe(1);
    expect(driver.started).toHaveLength(1);
  });

  it.each<PersistenceBoundary>(["data_written", "data_synced", "temp_state_written", "temp_state_synced", "state_renamed", "directory_synced"])(
    "recovers safely after a fault at %s",
    async (boundary) => {
      directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
      let armed = false;
      const crashing = new FileTransferHandler(new StreamingDriver() as unknown as PrinterDriver, "device-1", directory, {
        repositoryOptions: { onBoundary: (current) => { if (armed && current === boundary) throw new Error(`crash:${boundary}`); } },
      });
      await crashing.start(start({ start_print: false }));
      armed = true;
      await expect(crashing.chunk(chunk(0, "aGVs"))).rejects.toThrow(`crash:${boundary}`);

      const restarted = new FileTransferHandler(new StreamingDriver() as unknown as PrinterDriver, "device-1", directory);
      const resume = await restarted.start(start({ start_print: false }));
      const stateWasRenamed = boundary === "state_renamed" || boundary === "directory_synced";
      expect(resume).toMatchObject({
        type: "file_start_ack",
        next_seq: stateWasRenamed ? 1 : 0,
        next_offset_bytes: stateWasRenamed ? 3 : 0,
      });
      expect((await stat(join(directory, "transfer-1.part"))).size).toBe(stateWasRenamed ? 3 : 0);
    },
  );

  it("quarantines checksum-corrupt and unknown spool schemas without invoking the driver", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory);
    await handler.start(start());
    const path = join(directory, "transfer-1.json");
    const persisted = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...persisted, updatedAt: "2020-01-01T00:00:00.000Z" }));
    await expect(handler.start(start())).resolves.toMatchObject({ outcome: "failed", error_code: "transfer_conflict", message: "state_checksum_mismatch" });
    expect(driver.uploadCalls).toBe(0);

    await writeFile(join(directory, "unknown.json"), JSON.stringify({ schemaVersion: 999 }));
    await writeFile(join(directory, "unknown.part"), "preserve-me");
    await expect(handler.start(start({ transfer_id: "unknown" }))).resolves.toMatchObject({ outcome: "failed", error_code: "transfer_conflict", message: "unknown_or_invalid_schema" });
    await expect(readFile(join(directory, "unknown.part"), "utf8")).resolves.toBe("preserve-me");
  });

  it("retains terminal replay records until explicit bounded garbage collection", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory);
    await handler.start(start({ start_print: false }));
    const terminal = await handler.chunk(chunk(0, "aGVsbG8=", true, 0));
    await expect(handler.start(start({ start_print: false }))).resolves.toEqual(terminal);
    expect(driver.uploadCalls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await expect(handler.garbageCollectTerminal(0)).resolves.toBe(1);
    await expect(stat(join(directory, "transfer-1.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revalidates authorization before terminal side effects", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const driver = new StreamingDriver();
    let authorized = true;
    const handler = new FileTransferHandler(driver as unknown as PrinterDriver, "device-1", directory, { authorize: ({ operation }) => operation !== "terminal" || authorized });
    await handler.start(start());
    authorized = false;
    await expect(handler.chunk(chunk(0, "aGVsbG8=", true, 0))).resolves.toMatchObject({ outcome: "failed", error_code: "device_not_authorized" });
    expect(driver.uploadCalls).toBe(0);
    expect(driver.started).toEqual([]);
  });

  it("reconciles a crash-window upload without issuing a second upload", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const crashingDriver = new StreamingDriver();
    crashingDriver.uploadGcodeStream = async (input) => {
      crashingDriver.uploadCalls += 1;
      for await (const _chunk of input.data) { /* consume */ }
      throw new Error("crash after remote upload");
    };
    const crashing = new FileTransferHandler(crashingDriver as unknown as PrinterDriver, "device-1", directory);
    await crashing.start(start({ start_print: false }));
    await expect(crashing.chunk(chunk(0, "aGVsbG8=", true, 0))).rejects.toThrow("crash after remote upload");

    const resumedDriver = new StreamingDriver();
    const resumed = new FileTransferHandler(resumedDriver as unknown as PrinterDriver, "device-1", directory, {
      reconcileUpload: async ({ remoteFileName, sizeBytes, sha256 }) => ({ status: "present", storedAs: `gcodes/${remoteFileName}`, sizeBytes, sha256 }),
    });
    await expect(resumed.start(start({ start_print: false }))).resolves.toMatchObject({ outcome: "stored" });
    expect(crashingDriver.uploadCalls).toBe(1);
    expect(resumedDriver.uploadCalls).toBe(0);
  });

  it("reconciles a crash-window start from PrinterDriver status without issuing a second start", async () => {
    directory = await mkdtemp(join(tmpdir(), "portal-file-transfer-"));
    const crashingDriver = new StreamingDriver();
    crashingDriver.startPrint = async (fileName) => {
      crashingDriver.started.push(fileName);
      crashingDriver.statusFileName = fileName;
      throw new Error("crash after start accepted");
    };
    const crashing = new FileTransferHandler(crashingDriver as unknown as PrinterDriver, "device-1", directory);
    await crashing.start(start());
    await expect(crashing.chunk(chunk(0, "aGVsbG8=", true, 0))).rejects.toThrow("crash after start accepted");

    const resumedDriver = new StreamingDriver();
    resumedDriver.statusFileName = crashingDriver.statusFileName;
    const resumed = new FileTransferHandler(resumedDriver as unknown as PrinterDriver, "device-1", directory);
    await expect(resumed.start(start())).resolves.toMatchObject({ outcome: "stored" });
    expect(crashingDriver.started).toHaveLength(1);
    expect(resumedDriver.started).toHaveLength(0);
  });
});
