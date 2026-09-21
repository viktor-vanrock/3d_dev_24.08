import { createHash, randomUUID, type Hash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { FileChunkAck, FileChunkHeader, FileResult, FileStart, FileStartAck } from "@portal/contracts/device-protocol/v1";
import type { RelayTransferMetadataResponseDto, RelayTransferSourceUrlResponseDto } from "@portal/contracts/http/relay-internal.v1.dto";
import { RelayApiClient } from "../api/relay-api-client.service.ts";
import { RelayLogger } from "../observability/relay-logger.ts";
import { TRANSFER_SESSION_PORT, type TransferSessionFence, type TransferSessionPort } from "./transfer-session.port.ts";

export const FILE_TRANSFER_OPTIONS = Symbol("FILE_TRANSFER_OPTIONS");

export interface FileTransferOptions {
  readonly sourceFetch: typeof fetch;
  readonly sourceTimeoutMs: number;
}

const DEFAULT_OPTIONS: FileTransferOptions = {
  sourceFetch: fetch,
  sourceTimeoutMs: 10_000,
};

type ApiTransferErrorCode = "device_not_owned" | "device_revoked" | "invalid_transfer" | "invalid_file" | "transfer_conflict" | "invalid_sequence" | "checksum_mismatch" | "size_mismatch" | "source_changed" | "upload_failed" | "start_failed" | "timeout" | "disconnected" | "internal_error" | "disk_full" | "quota_exceeded" | "write_error" | "transfer_expired" | "cancelled";
type TransferOutcome = { readonly accepted: true; readonly replayed: boolean } | { readonly accepted: false; readonly errorCode: ApiTransferErrorCode };

interface PendingChunk {
  readonly seq: number;
  readonly offset: number;
  readonly nextSequence: number;
  readonly nextOffset: number;
  readonly last: boolean;
  readonly operationId: string;
}

interface ActiveTransfer {
  readonly session: TransferSessionFence;
  readonly metadata: RelayTransferMetadataResponseDto;
  readonly resultOperationId: string;
  source?: RelayTransferSourceUrlResponseDto;
  sourceReader?: ReadableStreamDefaultReader<Uint8Array>;
  sourceRemainder?: Buffer;
  nextSequence: number;
  nextOffset: number;
  pending?: PendingChunk;
  checksum?: Hash;
  pumping: boolean;
  closed: boolean;
}

class TransferFailure extends Error {
  constructor(readonly code: ApiTransferErrorCode) {
    super(code);
  }
}

@Injectable()
export class FileTransferService {
  private readonly active = new Map<string, ActiveTransfer>();
  private readonly options: FileTransferOptions;

  constructor(
    @Inject(RelayApiClient) private readonly api: RelayApiClient,
    @Inject(TRANSFER_SESSION_PORT) private readonly sessions: TransferSessionPort,
    @Inject(RelayLogger) private readonly logger: RelayLogger,
    @Inject(FILE_TRANSFER_OPTIONS) options: Partial<FileTransferOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (!Number.isSafeInteger(this.options.sourceTimeoutMs) || this.options.sourceTimeoutMs < 1) throw new Error("sourceTimeoutMs must be a positive safe integer");
  }

  get activeCount(): number {
    return this.active.size;
  }

  cancelTransfers(transferIds: readonly string[]): { readonly cancelled: readonly string[]; readonly notActive: readonly string[] } {
    const cancelled: string[] = [];
    const notActive: string[] = [];
    for (const transferId of transferIds) {
      const entry = this.active.get(transferId);
      if (!entry || entry.closed) {
        notActive.push(transferId);
        continue;
      }
      this.release(entry);
      cancelled.push(transferId);
    }
    return { cancelled, notActive };
  }

  async startTransfer(session: TransferSessionFence, transferId: string): Promise<TransferOutcome> {
    if (!this.sessions.isCurrent(session)) return { accepted: false, errorCode: "disconnected" };
    const previous = this.active.get(transferId);
    if (previous && !previous.closed && this.sameSession(previous.session, session)) {
      return { accepted: true, replayed: true };
    }
    if (previous) {
      previous.closed = true;
      this.active.delete(transferId);
    }
    try {
      const metadata = await this.api.v1.relayTransferMetadata({
        headers: { "x-correlation-id": randomUUID() },
        path: { transferId },
        query: { session_id: session.sessionId, session_generation: session.sessionGeneration },
      });
      this.assertAuthorizedMetadata(session, transferId, metadata);
      const entry: ActiveTransfer = {
        session,
        metadata,
        resultOperationId: randomUUID(),
        nextSequence: metadata.next_sequence,
        nextOffset: metadata.next_offset,
        checksum: metadata.next_offset === 0 ? createHash("sha256") : undefined,
        pumping: false,
        closed: false,
      };
      this.active.set(transferId, entry);
      const outcome = await this.sessions.sendFileStart(session, this.toFileStart(metadata));
      if (outcome !== "sent") {
        this.release(entry);
        return { accepted: false, errorCode: "disconnected" };
      }
      return { accepted: true, replayed: metadata.next_offset > 0 };
    } catch (error) {
      this.active.delete(transferId);
      this.logger.warn({ event: "relay_transfer_start_rejected", transfer_id: transferId, outcome: "rejected" }, "file transfer start rejected safely");
      return { accepted: false, errorCode: error instanceof TransferFailure ? error.code : "invalid_transfer" };
    }
  }

  async handleStartAcknowledged(session: TransferSessionFence, frame: FileStartAck): Promise<TransferOutcome> {
    const entry = this.match(session, frame.device_id, frame.transfer_id);
    if (!entry) return { accepted: false, errorCode: "invalid_transfer" };
    if (frame.next_seq !== entry.nextSequence || frame.next_offset_bytes !== entry.nextOffset) return this.fail(entry, "invalid_sequence");
    await this.pump(entry);
    return entry.closed ? { accepted: false, errorCode: "disconnected" } : { accepted: true, replayed: entry.nextOffset > entry.metadata.next_offset };
  }

  async handleChunkAcknowledged(session: TransferSessionFence, frame: FileChunkAck): Promise<TransferOutcome> {
    const entry = this.match(session, frame.device_id, frame.transfer_id);
    if (!entry?.pending) return { accepted: false, errorCode: "invalid_sequence" };
    const pending = entry.pending;
    if (frame.seq !== pending.seq || frame.next_seq !== pending.nextSequence || frame.next_offset_bytes !== pending.nextOffset) {
      return this.fail(entry, "invalid_sequence");
    }
    const progress = await this.persistPendingProgress(entry);
    if (!progress.accepted) return progress;
    if (!pending.last) await this.pump(entry);
    return progress;
  }

  async handleResult(session: TransferSessionFence, frame: FileResult): Promise<TransferOutcome> {
    const entry = this.match(session, frame.device_id, frame.transfer_id);
    if (!entry) return { accepted: false, errorCode: "invalid_transfer" };
    if (frame.outcome === "stored") {
      if (entry.pending) {
        if (!entry.pending.last) return this.fail(entry, "size_mismatch");
        const progress = await this.persistPendingProgress(entry);
        if (!progress.accepted) return progress;
      }
      if (entry.nextOffset !== entry.metadata.size_bytes) return this.fail(entry, "size_mismatch");
      if (entry.checksum) {
        const digest = entry.checksum.digest("hex");
        entry.checksum = undefined;
        if (digest !== entry.metadata.sha256.toLowerCase()) return this.fail(entry, "checksum_mismatch");
      }
      return this.persistResult(entry, "completed");
    }
    return this.persistResult(entry, "failed", this.mapAgentError(frame.error_code));
  }

  handleDisconnect(session: TransferSessionFence): void {
    for (const [transferId, entry] of this.active) {
      if (this.sameSession(entry.session, session)) {
        entry.closed = true;
        this.active.delete(transferId);
      }
    }
  }

  private async persistPendingProgress(entry: ActiveTransfer): Promise<TransferOutcome> {
    const pending = entry.pending;
    if (!pending) return { accepted: false, errorCode: "invalid_sequence" };
    try {
      const response = await this.api.v1.relayTransferProgress({
        headers: { "x-correlation-id": randomUUID(), "x-operation-id": pending.operationId },
        path: { transferId: entry.metadata.transfer_id },
        body: {
          session_id: entry.session.sessionId,
          session_generation: entry.session.sessionGeneration,
          object_version: entry.metadata.object_version,
          next_sequence: pending.nextSequence,
          next_offset: pending.nextOffset,
          observed_at: new Date().toISOString(),
        },
      });
      if (response.next_sequence !== pending.nextSequence || response.next_offset !== pending.nextOffset) return this.fail(entry, "transfer_conflict");
      entry.nextSequence = pending.nextSequence;
      entry.nextOffset = pending.nextOffset;
      entry.pending = undefined;
      return { accepted: true, replayed: response.replayed };
    } catch {
      return { accepted: false, errorCode: "internal_error" };
    }
  }

  private async pump(entry: ActiveTransfer): Promise<void> {
    if (entry.pumping || entry.pending || entry.closed) return;
    if (!this.sessions.isCurrent(entry.session) || !this.sessions.authorizes(entry.session, entry.metadata.device_id)) {
      await this.fail(entry, "device_revoked");
      return;
    }
    if (entry.nextOffset >= entry.metadata.size_bytes) return;
    entry.pumping = true;
    try {
      const bytes = await this.readChunk(entry);
      entry.checksum?.update(bytes);
      const pending: PendingChunk = {
        seq: entry.nextSequence,
        offset: entry.nextOffset,
        nextSequence: entry.nextSequence + 1,
        nextOffset: entry.nextOffset + bytes.byteLength,
        last: entry.nextOffset + bytes.byteLength === entry.metadata.size_bytes,
        operationId: randomUUID(),
      };
      const header: FileChunkHeader = {
        type: "file_chunk_header",
        device_id: entry.metadata.device_id,
        transfer_id: entry.metadata.transfer_id,
        seq: pending.seq,
        offset_bytes: pending.offset,
        size_bytes: bytes.byteLength,
        last: pending.last,
      };
      const outcome = await this.sessions.sendFileChunk(entry.session, header, bytes);
      if (outcome !== "sent") {
        this.release(entry);
        return;
      }
      entry.pending = pending;
    } catch (error) {
      if (error instanceof TransferFailure && ["source_changed", "size_mismatch", "checksum_mismatch", "timeout"].includes(error.code)) {
        await this.fail(entry, error.code);
      } else {
        this.release(entry);
      }
    } finally {
      entry.pumping = false;
    }
  }

  /** Opens one HTTP stream per relay session; a reconnect resumes with one Range request. */
  private async readChunk(entry: ActiveTransfer): Promise<Buffer> {
    const chunkSize = entry.metadata.chunk_size_bytes;
    const parts: Buffer[] = [];
    let received = 0;
    if (entry.sourceRemainder?.length) {
      const first = entry.sourceRemainder;
      entry.sourceRemainder = undefined;
      if (first.length > chunkSize) {
        parts.push(first.subarray(0, chunkSize));
        entry.sourceRemainder = first.subarray(chunkSize);
        return Buffer.concat(parts, chunkSize);
      }
      parts.push(first);
      received = first.length;
    }
    if (!entry.sourceReader) entry.sourceReader = await this.openSourceStream(entry);
    while (received < chunkSize) {
      const { done, value } = await entry.sourceReader.read();
      if (done) break;
      const bytes = Buffer.from(value);
      const remaining = chunkSize - received;
      if (bytes.length > remaining) {
        parts.push(bytes.subarray(0, remaining));
        entry.sourceRemainder = bytes.subarray(remaining);
        received += remaining;
        break;
      }
      parts.push(bytes);
      received += bytes.length;
    }
    if (received === 0 || entry.nextOffset + received > entry.metadata.size_bytes) throw new TransferFailure("size_mismatch");
    if (entry.nextOffset + received < entry.metadata.size_bytes && received !== chunkSize) throw new TransferFailure("size_mismatch");
    return Buffer.concat(parts, received);
  }

  private async openSourceStream(entry: ActiveTransfer): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const source = await this.ensureSource(entry, attempt > 0);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.sourceTimeoutMs);
      timeout.unref();
      try {
        let response: Response;
        try {
          response = await this.options.sourceFetch(source.source_url, {
            headers: entry.nextOffset > 0 ? { range: `bytes=${entry.nextOffset}-` } : {},
            signal: controller.signal,
            redirect: "error",
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw new TransferFailure("timeout");
          throw error;
        }
        if ((response.status === 401 || response.status === 403) && attempt === 0) {
          entry.source = undefined;
          continue;
        }
        const expectedStatus = entry.nextOffset > 0 ? 206 : 200;
        if (response.status !== expectedStatus) {
          if (response.status === 401 || response.status === 403) throw new TransferFailure("invalid_transfer");
          if (response.status >= 500) throw new Error("source temporarily unavailable");
          throw new TransferFailure("source_changed");
        }
        if (!response.body) throw new TransferFailure("size_mismatch");
        const declaredLength = response.headers.get("content-length");
        const expectedLength = entry.metadata.size_bytes - entry.nextOffset;
        if (declaredLength !== null && Number(declaredLength) !== expectedLength) {
          throw new TransferFailure("size_mismatch");
        }
        if (entry.nextOffset > 0 && response.headers.get("content-range") !== `bytes ${entry.nextOffset}-${entry.metadata.size_bytes - 1}/${entry.metadata.size_bytes}`) {
          throw new TransferFailure("size_mismatch");
        }
        return response.body.getReader();
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new TransferFailure("invalid_transfer");
  }

  private async ensureSource(entry: ActiveTransfer, forceRefresh: boolean): Promise<RelayTransferSourceUrlResponseDto> {
    if (!forceRefresh && entry.source && Date.parse(entry.source.expires_at) > Date.now() + 1_000) return entry.source;
    const source = await this.api.v1.relayTransferSourceUrl({
      headers: { "x-correlation-id": randomUUID(), "x-operation-id": randomUUID() },
      path: { transferId: entry.metadata.transfer_id },
      body: {
        session_id: entry.session.sessionId,
        session_generation: entry.session.sessionGeneration,
        object_version: entry.metadata.object_version,
        size_bytes: entry.metadata.size_bytes,
        sha256: entry.metadata.sha256,
        next_sequence: entry.nextSequence,
        next_offset: entry.nextOffset,
      },
    });
    this.assertSameSource(entry.metadata, source);
    if (!source.source_url.startsWith("https://") || !source.range_supported) throw new TransferFailure("invalid_transfer");
    entry.source = source;
    return source;
  }

  private async fail(entry: ActiveTransfer, errorCode: ApiTransferErrorCode): Promise<TransferOutcome> {
    if (entry.closed) return { accepted: false, errorCode };
    const outcome = await this.persistResult(entry, "failed", errorCode);
    return outcome.accepted ? { accepted: false, errorCode } : outcome;
  }

  private release(entry: ActiveTransfer): void {
    if (entry.closed) return;
    entry.closed = true;
    this.active.delete(entry.metadata.transfer_id);
  }

  private async persistResult(entry: ActiveTransfer, status: "completed" | "failed", errorCode?: ApiTransferErrorCode): Promise<TransferOutcome> {
    try {
      const response = await this.api.v1.relayTransferResult({
        headers: { "x-correlation-id": randomUUID(), "x-operation-id": entry.resultOperationId },
        path: { transferId: entry.metadata.transfer_id },
        body: {
          session_id: entry.session.sessionId,
          session_generation: entry.session.sessionGeneration,
          object_version: entry.metadata.object_version,
          next_sequence: entry.nextSequence,
          next_offset: entry.nextOffset,
          status,
          ...(errorCode ? { error_code: errorCode } : {}),
          observed_at: new Date().toISOString(),
        },
      });
      entry.closed = true;
      this.active.delete(entry.metadata.transfer_id);
      return { accepted: true, replayed: response.replayed };
    } catch {
      return { accepted: false, errorCode: "internal_error" };
    }
  }

  private assertAuthorizedMetadata(session: TransferSessionFence, transferId: string, metadata: RelayTransferMetadataResponseDto): void {
    if (metadata.transfer_id !== transferId || metadata.session_id !== session.sessionId || metadata.session_generation !== session.sessionGeneration || metadata.gateway_id !== session.gatewayId) throw new TransferFailure("invalid_transfer");
    if (!this.sessions.isCurrent(session) || !this.sessions.authorizes(session, metadata.device_id)) throw new TransferFailure("device_not_owned");
    if (!Number.isSafeInteger(metadata.size_bytes) || metadata.size_bytes < 1 || !Number.isSafeInteger(metadata.chunk_size_bytes) || metadata.chunk_size_bytes < 1 || metadata.chunk_size_bytes > 65_536) throw new TransferFailure("invalid_file");
    if (!Number.isSafeInteger(metadata.next_offset) || metadata.next_offset < 0 || metadata.next_offset > metadata.size_bytes || !Number.isSafeInteger(metadata.next_sequence) || metadata.next_sequence < 0) throw new TransferFailure("invalid_sequence");
    if (!/^[0-9a-f]{64}$/i.test(metadata.sha256)) throw new TransferFailure("invalid_file");
  }

  private assertSameSource(metadata: RelayTransferMetadataResponseDto, source: RelayTransferSourceUrlResponseDto): void {
    if (source.transfer_id !== metadata.transfer_id || source.object_version !== metadata.object_version) throw new TransferFailure("source_changed");
    if (source.size_bytes !== metadata.size_bytes) throw new TransferFailure("size_mismatch");
    if (source.sha256.toLowerCase() !== metadata.sha256.toLowerCase()) throw new TransferFailure("checksum_mismatch");
    const active = this.active.get(metadata.transfer_id);
    if (source.next_offset !== (active?.nextOffset ?? metadata.next_offset) || source.next_sequence !== (active?.nextSequence ?? metadata.next_sequence)) throw new TransferFailure("transfer_conflict");
  }

  private toFileStart(metadata: RelayTransferMetadataResponseDto): FileStart {
    return {
      type: "file_start",
      device_id: metadata.device_id,
      transfer_id: metadata.transfer_id,
      file_name: metadata.file_name,
      size_bytes: metadata.size_bytes,
      sha256: metadata.sha256,
      object_version: metadata.object_version,
      kind: metadata.kind,
      start_print: metadata.start_print,
      chunk_size_bytes: metadata.chunk_size_bytes,
    };
  }

  private match(session: TransferSessionFence, deviceId: string, transferId: string): ActiveTransfer | undefined {
    const entry = this.active.get(transferId);
    if (!entry || entry.closed || !this.sameSession(entry.session, session) || !this.sessions.isCurrent(session) || !this.sessions.authorizes(session, deviceId) || entry.metadata.device_id !== deviceId) return undefined;
    return entry;
  }

  private sameSession(left: TransferSessionFence, right: TransferSessionFence): boolean {
    return left.gatewayId === right.gatewayId && left.sessionId === right.sessionId && left.sessionGeneration === right.sessionGeneration && left.connectionId === right.connectionId;
  }

  private mapAgentError(code: Extract<FileResult, { readonly outcome: "failed" }>["error_code"]): ApiTransferErrorCode {
    const mapping: Record<typeof code, ApiTransferErrorCode> = {
      device_not_authorized: "device_not_owned",
      invalid_transfer: "invalid_transfer",
      transfer_conflict: "transfer_conflict",
      unknown_transfer: "invalid_transfer",
      invalid_sequence: "invalid_sequence",
      invalid_data: "invalid_file",
      source_changed: "source_changed",
      file_size_mismatch: "size_mismatch",
      checksum_mismatch: "checksum_mismatch",
      upload_failed: "upload_failed",
      start_failed: "start_failed",
      transfer_timeout: "timeout",
      disk_full: "disk_full",
      quota_exceeded: "quota_exceeded",
      write_error: "write_error",
      transfer_expired: "transfer_expired",
      cancelled: "cancelled",
    };
    return mapping[code];
  }
}
