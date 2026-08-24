import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { DeviceId, GatewayId, TransferId } from "@portal/contracts/device-agent-runtime/v1";
import type { PrinterDriver, UploadResult } from "../driver/printerDriver.ts";
import { KeyedExecutor } from "./keyedExecutor.ts";
import type { FileChunkFrame, FileChunkAckFrame, FileResultFrame, FileStartAckFrame, FileStartFrame, FileTransferKind } from "./protocol.ts";
import {
  digestBytes,
  metadataHash,
  TransferSpoolRepository,
  type TransferMetadata,
  type TransferSpoolRepositoryOptions,
  type TransferSpoolState,
} from "./transferSpoolRepository.ts";

type FileResponse = FileChunkAckFrame | FileResultFrame;
type AuthorizationCheck = (input: { gatewayId: string; deviceId: string; transferId: string; operation: "start" | "chunk" | "terminal" }) => boolean | Promise<boolean>;
type UploadReconciliation = { status: "present"; storedAs: string; sizeBytes: number; sha256: string } | { status: "absent" } | { status: "unknown" };

export interface FileTransferHandlerOptions {
  gatewayId?: string;
  maxConcurrentTransfers?: number;
  maxSpoolBytes?: number;
  terminalRetentionMs?: number;
  authorize?: AuthorizationCheck;
  reconcileUpload?: (input: { remoteFileName: string; root: "gcodes" | "config"; sizeBytes: number; sha256: string }) => Promise<UploadReconciliation>;
  repository?: TransferSpoolRepository;
  repositoryOptions?: TransferSpoolRepositoryOptions;
}

const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_SPOOL_BYTES = 2 * MAX_FILE_BYTES;

/** Durable, serialized file transfer processing. Relay wire-v1 frames remain unchanged. */
export class FileTransferHandler {
  private readonly repository: TransferSpoolRepository;
  private readonly executor: KeyedExecutor;
  private readonly budgetExecutor = new KeyedExecutor(1);
  private readonly gatewayId: string;
  private readonly maxSpoolBytes: number;
  private readonly terminalRetentionMs: number;
  private readonly authorize: AuthorizationCheck;
  private readonly reconcileUpload?: FileTransferHandlerOptions["reconcileUpload"];

  constructor(
    private readonly driver: PrinterDriver,
    private readonly deviceId: string,
    spoolDirectory: string,
    options: FileTransferHandlerOptions = {},
  ) {
    this.repository = options.repository ?? new TransferSpoolRepository(spoolDirectory, options.repositoryOptions);
    this.executor = new KeyedExecutor(options.maxConcurrentTransfers ?? 4);
    this.gatewayId = options.gatewayId ?? deviceId;
    this.maxSpoolBytes = options.maxSpoolBytes ?? DEFAULT_MAX_SPOOL_BYTES;
    this.terminalRetentionMs = options.terminalRetentionMs ?? 7 * 24 * 60 * 60 * 1000;
    this.authorize = options.authorize ?? (() => true);
    this.reconcileUpload = options.reconcileUpload;
  }

  start(frame: FileStartFrame): Promise<FileStartAckFrame | FileResultFrame> {
    return this.executor.run(frame.transfer_id, () => this.budgetExecutor.run("spool", () => this.startSerialized(frame)));
  }

  chunk(frame: FileChunkFrame): Promise<FileResponse> {
    return this.executor.run(frame.transfer_id, () => this.chunkSerialized(frame));
  }

  garbageCollectTerminal(retentionMs: number): Promise<number> {
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 0) throw new Error("retentionMs must be a non-negative integer");
    return this.repository.garbageCollectTerminal(new Date(Date.now() - retentionMs));
  }

  async shutdown(deadlineMs: number): Promise<boolean> {
    const started = Date.now();
    const transfersIdle = await this.executor.shutdown(deadlineMs);
    const remaining = Math.max(0, deadlineMs - (Date.now() - started));
    const budgetIdle = await this.budgetExecutor.shutdown(remaining);
    return transfersIdle && budgetIdle;
  }

  private async startSerialized(frame: FileStartFrame): Promise<FileStartAckFrame | FileResultFrame> {
    await this.repository.garbageCollectTerminal(new Date(Date.now() - this.terminalRetentionMs));
    if (!await this.authorized(frame.device_id, frame.transfer_id, "start")) return this.error(frame.transfer_id, "device_not_authorized");
    if (!isSafeTransferId(frame.transfer_id)) return this.error(frame.transfer_id, "invalid_transfer");
    const metadata = metadataFromStart(frame, this.gatewayId);
    if (!metadata) return this.error(frame.transfer_id, "invalid_transfer");

    const loaded = await this.repository.load(frame.transfer_id);
    if (loaded.kind === "quarantined") return this.error(frame.transfer_id, "transfer_conflict", undefined, undefined, loaded.reason);
    if (loaded.kind === "ready") {
      if (metadataHash(loaded.state.metadata) !== metadataHash(metadata)) {
        return this.error(frame.transfer_id, "source_changed", loaded.state.nextSequence, loaded.state.committedOffset);
      }
      if (loaded.state.terminalResult) {
        await this.repository.removePartial(loaded.state);
        return loaded.state.terminalResult;
      }
      if (loaded.state.phase !== "receiving") return this.reconcileInterrupted(loaded.state);
      return this.startAck(loaded.state);
    }
    if (metadata.sizeBytes > this.maxSpoolBytes - await this.repository.allocatedBytes()) return this.error(frame.transfer_id, "transfer_timeout", undefined, undefined, "spool_space_budget_exceeded");
    try {
      return this.startAck(await this.repository.create(metadata));
    } catch (error) {
      const raced = await this.repository.load(frame.transfer_id);
      if (raced.kind === "ready" && metadataHash(raced.state.metadata) === metadataHash(metadata)) return this.startAck(raced.state);
      throw error;
    }
  }

  private async chunkSerialized(frame: FileChunkFrame): Promise<FileResponse> {
    if (!await this.authorized(frame.device_id, frame.transfer_id, "chunk")) return this.error(frame.transfer_id, "device_not_authorized");
    if (!isSafeTransferId(frame.transfer_id)) return this.error(frame.transfer_id, "invalid_transfer");
    const loaded = await this.repository.load(frame.transfer_id);
    if (loaded.kind === "missing") return this.error(frame.transfer_id, "unknown_transfer");
    if (loaded.kind === "quarantined") return this.error(frame.transfer_id, "transfer_conflict", undefined, undefined, loaded.reason);
    let state = loaded.state;
    if (!await this.metadataStillAuthorized(state, frame)) return this.error(frame.transfer_id, "source_changed", state.nextSequence, state.committedOffset);

    if (state.terminalResult) {
      const duplicateData = decodeBase64(frame.data_base64);
      if (duplicateData && frame.seq < state.nextSequence) return this.replayCommittedFrame(frame, duplicateData, state);
      return this.error(frame.transfer_id, "transfer_conflict", state.nextSequence, state.committedOffset, "conflicting_terminal_frame");
    }
    if (state.phase !== "receiving") return this.reconcileInterrupted(state);
    if (frame.seq > state.nextSequence || (frame.seq === state.nextSequence && frame.offset_bytes !== state.committedOffset)) return this.error(frame.transfer_id, "invalid_sequence", state.nextSequence, state.committedOffset);
    const data = decodeBase64(frame.data_base64);
    if (!data || data.byteLength > state.metadata.chunkSizeBytes) return this.error(frame.transfer_id, "invalid_data", state.nextSequence, state.committedOffset);
    if (frame.seq < state.nextSequence) return this.replayCommittedFrame(frame, data, state);
    if (state.committedOffset + data.byteLength > state.metadata.sizeBytes) return this.error(frame.transfer_id, "file_size_mismatch", state.nextSequence, state.committedOffset);

    state = await this.repository.commitChunk(state, data, {
      seq: frame.seq,
      offsetBytes: frame.offset_bytes,
      lengthBytes: data.byteLength,
      digestSha256: digestBytes(data),
      last: frame.last,
    });
    if (!frame.last) return this.chunkAck(frame, state);
    return this.finish(state);
  }

  private async replayCommittedFrame(frame: FileChunkFrame, data: Buffer, state: TransferSpoolState): Promise<FileResponse> {
    const committed = state.frames[frame.seq];
    if (!committed || committed.offsetBytes !== frame.offset_bytes || committed.lengthBytes !== data.byteLength || committed.digestSha256 !== digestBytes(data) || committed.last !== frame.last) {
      return this.error(frame.transfer_id, "transfer_conflict", state.nextSequence, state.committedOffset, "conflicting_duplicate_frame");
    }
    if (committed.last && state.terminalResult) return state.terminalResult;
    if (committed.last && state.phase !== "receiving") return this.reconcileInterrupted(state);
    return this.chunkAck(frame, state);
  }

  private async finish(state: TransferSpoolState): Promise<FileResultFrame> {
    if (!await this.authorized(state.metadata.deviceId, state.metadata.transferId, "terminal") || !this.validMetadata(state.metadata)) {
      return this.persistTerminalFailure(state, "device_not_authorized");
    }
    if (state.committedOffset !== state.metadata.sizeBytes) return this.persistTerminalFailure(state, "file_size_mismatch");
    if ((await sha256(this.repository.partPath(state.metadata.transferId))) !== state.metadata.sha256) return this.persistTerminalFailure(state, "checksum_mismatch");

    const remoteFileName = deterministicRemoteFileName(state.metadata);
    state = await this.repository.update(state, { phase: "upload_intent", uploadIntent: { attemptedAt: new Date().toISOString() } });
    const upload = await this.upload(state, remoteFileName);
    if (!upload.ok) {
      state = await this.repository.update(state, { uploadResult: { ok: false, error: upload.error ?? "upload_failed" } });
      return this.persistTerminalFailure(state, "upload_failed", upload.error);
    }
    state = await this.repository.update(state, { phase: "upload_complete", uploadResult: { ok: true, storedAs: upload.storedAs ?? remoteFileName } });

    if (state.metadata.startPrint) {
      if (!await this.authorized(state.metadata.deviceId, state.metadata.transferId, "terminal") || !this.validMetadata(state.metadata)) return this.persistTerminalFailure(state, "device_not_authorized");
      state = await this.repository.update(state, { phase: "start_intent", startIntent: { attemptedAt: new Date().toISOString() } });
      const started = await this.driver.startPrint(upload.storedAs ?? remoteFileName);
      if (!started.ok) {
        state = await this.repository.update(state, { startResult: { ok: false, error: started.error ?? "start_failed" } });
        return this.persistTerminalFailure(state, "start_failed", started.error);
      }
      state = await this.repository.update(state, { startResult: { ok: true } });
    }
    const terminal: FileResultFrame = { type: "file_result", device_id: this.deviceId, transfer_id: state.metadata.transferId, outcome: "stored", stored_as: upload.storedAs ?? remoteFileName };
    state = await this.repository.update(state, { phase: "terminal", terminalResult: terminal });
    await this.repository.removePartial(state);
    return terminal;
  }

  private async reconcileInterrupted(state: TransferSpoolState): Promise<FileResultFrame> {
    if (state.terminalResult) return state.terminalResult;
    if (!await this.authorized(state.metadata.deviceId, state.metadata.transferId, "terminal") || !this.validMetadata(state.metadata)) return this.persistTerminalFailure(state, "device_not_authorized");
    const remoteFileName = deterministicRemoteFileName(state.metadata);

    if (state.phase === "upload_intent") {
      const reconciled = this.reconcileUpload ? await this.reconcileUpload({ remoteFileName, root: rootFor(state.metadata), sizeBytes: state.metadata.sizeBytes, sha256: state.metadata.sha256 }) : { status: "unknown" } as const;
      if (reconciled.status === "present" && reconciled.sizeBytes === state.metadata.sizeBytes && reconciled.sha256 === state.metadata.sha256) {
        state = await this.repository.update(state, { phase: "upload_complete", uploadResult: { ok: true, storedAs: reconciled.storedAs } });
      } else if (reconciled.status === "absent") {
        const upload = await this.upload(state, remoteFileName);
        if (!upload.ok) {
          state = await this.repository.update(state, { uploadResult: { ok: false, error: upload.error ?? "upload_failed" } });
          return this.persistTerminalFailure(state, "upload_failed", upload.error);
        }
        state = await this.repository.update(state, { phase: "upload_complete", uploadResult: { ok: true, storedAs: upload.storedAs ?? remoteFileName } });
      } else {
        return this.reconciliationRequired(state, "upload_result_unknown");
      }
    }

    if (state.phase === "start_intent") {
      const status = await this.driver.status();
      const expected = state.uploadResult?.ok ? state.uploadResult.storedAs : remoteFileName;
      if (status.jobFileName === expected || status.jobFileName === basename(expected)) {
        state = await this.repository.update(state, { startResult: { ok: true } });
      } else {
        return this.reconciliationRequired(state, "start_result_unknown");
      }
    }

    if (state.phase === "upload_complete" && state.metadata.startPrint && state.startIntent === null) {
      state = await this.repository.update(state, { phase: "start_intent", startIntent: { attemptedAt: new Date().toISOString() } });
      const expected = state.uploadResult?.ok ? state.uploadResult.storedAs : remoteFileName;
      const started = await this.driver.startPrint(expected);
      if (!started.ok) {
        state = await this.repository.update(state, { startResult: { ok: false, error: started.error ?? "start_failed" } });
        return this.persistTerminalFailure(state, "start_failed", started.error);
      }
      state = await this.repository.update(state, { startResult: { ok: true } });
    }

    if ((state.phase === "upload_complete" && !state.metadata.startPrint) || (state.startResult?.ok ?? false)) {
      const storedAs = state.uploadResult?.ok ? state.uploadResult.storedAs : remoteFileName;
      const terminal: FileResultFrame = { type: "file_result", device_id: this.deviceId, transfer_id: state.metadata.transferId, outcome: "stored", stored_as: storedAs };
      state = await this.repository.update(state, { phase: "terminal", terminalResult: terminal });
      await this.repository.removePartial(state);
      return terminal;
    }
    return this.reconciliationRequired(state, "terminal_state_incomplete");
  }

  private async reconciliationRequired(state: TransferSpoolState, reason: string): Promise<FileResultFrame> {
    await this.repository.update(state, { phase: "reconciliation_required", quarantineReason: reason });
    return this.error(state.metadata.transferId, "transfer_conflict", state.nextSequence, state.committedOffset, `reconciliation_required:${reason}`);
  }

  private async persistTerminalFailure(state: TransferSpoolState, code: Extract<FileResultFrame, { outcome: "failed" }>["error_code"], message?: string): Promise<FileResultFrame> {
    const terminal = this.error(state.metadata.transferId, code, state.nextSequence, state.committedOffset, message);
    const persisted = await this.repository.update(state, { phase: "terminal", terminalResult: terminal });
    await this.repository.removePartial(persisted);
    return terminal;
  }

  private async authorized(deviceId: string, transferId: string, operation: "start" | "chunk" | "terminal"): Promise<boolean> {
    return deviceId === this.deviceId && await this.authorize({ gatewayId: this.gatewayId, deviceId, transferId, operation });
  }

  private async metadataStillAuthorized(state: TransferSpoolState, frame: FileChunkFrame): Promise<boolean> {
    return frame.device_id === state.metadata.deviceId && state.metadata.gatewayId === this.gatewayId && state.metadata.deviceId === this.deviceId
      && state.metadataHashSha256 === metadataHash(state.metadata) && await this.authorized(frame.device_id, frame.transfer_id, "chunk");
  }

  private validMetadata(metadata: TransferMetadata): boolean {
    return metadata.gatewayId === this.gatewayId && metadata.deviceId === this.deviceId && metadataFromValues(metadata) !== null;
  }

  private startAck(state: TransferSpoolState): FileStartAckFrame {
    return { type: "file_start_ack", device_id: this.deviceId, transfer_id: state.metadata.transferId, next_seq: state.nextSequence, next_offset_bytes: state.committedOffset };
  }

  private chunkAck(frame: FileChunkFrame, state: TransferSpoolState): FileChunkAckFrame {
    return { type: "file_chunk_ack", device_id: this.deviceId, transfer_id: frame.transfer_id, seq: frame.seq, next_seq: state.nextSequence, next_offset_bytes: state.committedOffset };
  }

  private async upload(state: TransferSpoolState, remoteFileName: string): Promise<UploadResult> {
    if (!this.driver.uploadGcodeStream) return { ok: false, error: "stream_upload_not_supported" };
    return this.driver.uploadGcodeStream({ fileName: remoteFileName, size: state.metadata.sizeBytes, data: createReadStream(this.repository.partPath(state.metadata.transferId)), root: rootFor(state.metadata) });
  }

  private error(transferId: string, errorCode: Extract<FileResultFrame, { outcome: "failed" }>["error_code"], nextSeq?: number, nextOffsetBytes?: number, message?: string): FileResultFrame {
    return { type: "file_result", device_id: this.deviceId, transfer_id: transferId, outcome: "failed", error_code: errorCode,
      ...(nextSeq === undefined ? {} : { next_seq: nextSeq }), ...(nextOffsetBytes === undefined ? {} : { next_offset_bytes: nextOffsetBytes }), ...(message === undefined ? {} : { message: message.slice(0, 256) }) };
  }
}

function metadataFromStart(frame: FileStartFrame, gatewayId: string): TransferMetadata | null {
  const fileName = safeFileName(frame.file_name, frame.kind);
  const transferId = TransferId(frame.transfer_id);
  const validatedGatewayId = GatewayId(gatewayId);
  const deviceId = DeviceId(frame.device_id);
  if (transferId === null || validatedGatewayId === null || deviceId === null) return null;
  const candidate: TransferMetadata = { transferId, gatewayId: validatedGatewayId, deviceId, fileName: fileName ?? frame.file_name, sizeBytes: frame.size_bytes,
    sha256: frame.sha256, objectVersion: frame.object_version, chunkSizeBytes: frame.chunk_size_bytes, startPrint: frame.kind === "gcode" && frame.start_print, kind: frame.kind };
  return fileName && metadataFromValues(candidate) ? candidate : null;
}

function metadataFromValues(value: TransferMetadata): TransferMetadata | null {
  return isSafeTransferId(value.transferId) && value.gatewayId.length > 0 && value.deviceId.length > 0 && safeFileName(value.fileName, value.kind) !== null
    && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0 && value.sizeBytes <= MAX_FILE_BYTES && /^[0-9a-f]{64}$/.test(value.sha256)
    && value.objectVersion.length > 0 && Number.isSafeInteger(value.chunkSizeBytes) && value.chunkSizeBytes > 0 ? value : null;
}

function deterministicRemoteFileName(metadata: TransferMetadata): string {
  const extension = metadata.kind === "printer_profile" ? ".ini" : ".gcode";
  const stem = metadata.fileName.slice(0, -extension.length);
  return `${stem}.${metadata.sha256.slice(0, 16)}${extension}`;
}
function rootFor(metadata: TransferMetadata): "gcodes" | "config" { return metadata.kind === "printer_profile" ? "config" : "gcodes"; }
function safeFileName(value: string, kind: FileTransferKind): string | null { const name = basename(value); const pattern = kind === "printer_profile" ? /^[a-zA-Z0-9._-]+\.ini$/i : /^[a-zA-Z0-9._-]+\.gcode$/i; return name === value && pattern.test(name) ? name : null; }
function isSafeTransferId(value: string): boolean { return /^[a-zA-Z0-9._:-]{1,128}$/.test(value); }
function decodeBase64(value: string): Buffer | null { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) return null; const data = Buffer.from(value, "base64"); return data.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "") ? data : null; }
async function sha256(path: string): Promise<string> { const hash = createHash("sha256"); for await (const value of createReadStream(path) as AsyncIterable<Buffer>) hash.update(value); return hash.digest("hex"); }
