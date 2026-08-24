import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, truncate } from "node:fs/promises";
import { join } from "node:path";
import { isTransferSpoolStateV1, TRANSFER_SPOOL_SCHEMA_VERSION, type TransferSpoolStateV1 } from "@portal/contracts/device-agent-runtime/v1";

export { TRANSFER_SPOOL_SCHEMA_VERSION };

export type TransferMetadata = TransferSpoolStateV1["metadata"];
export type CommittedFrame = TransferSpoolStateV1["frames"][number];
export type DurableIntent = Exclude<TransferSpoolStateV1["uploadIntent"], null>;
export type DurableUploadResult = Exclude<TransferSpoolStateV1["uploadResult"], null>;
export type DurableStartResult = Exclude<TransferSpoolStateV1["startResult"], null>;
export type TransferPhase = TransferSpoolStateV1["phase"];
export type TransferSpoolState = TransferSpoolStateV1;

export type PersistenceBoundary = "data_written" | "data_synced" | "temp_state_written" | "temp_state_synced" | "state_renamed" | "directory_synced";

export interface TransferSpoolRepositoryOptions {
  onBoundary?: (boundary: PersistenceBoundary, transferId: string) => void | Promise<void>;
  now?: () => Date;
}

export type LoadResult = { kind: "missing" } | { kind: "ready"; state: TransferSpoolState } | { kind: "quarantined"; reason: string };

export class TransferSpoolRepository {
  private readonly onBoundary: NonNullable<TransferSpoolRepositoryOptions["onBoundary"]>;
  private readonly now: () => Date;

  constructor(
    private readonly directory: string,
    options: TransferSpoolRepositoryOptions = {},
  ) {
    this.onBoundary = options.onBoundary ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
  }

  partPath(transferId: string): string {
    return join(this.directory, `${transferId}.part`);
  }

  statePath(transferId: string): string {
    return join(this.directory, `${transferId}.json`);
  }

  async create(metadata: TransferMetadata): Promise<TransferSpoolState> {
    await mkdir(this.directory, { recursive: true });
    const part = await open(this.partPath(metadata.transferId), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await part.sync();
    } finally {
      await part.close();
    }
    const state = this.withChecksum({
      schemaVersion: TRANSFER_SPOOL_SCHEMA_VERSION,
      metadata,
      metadataHashSha256: metadataHash(metadata),
      stateChecksumSha256: "",
      committedOffset: 0,
      nextSequence: 0,
      phase: "receiving",
      frames: [],
      uploadIntent: null,
      uploadResult: null,
      startIntent: null,
      startResult: null,
      terminalResult: null,
      quarantineReason: null,
      updatedAt: this.now().toISOString(),
    });
    await this.persistState(state);
    return state;
  }

  async load(transferId: string): Promise<LoadResult> {
    let raw: string;
    try {
      raw = await readFile(this.statePath(transferId), "utf8");
    } catch (error) {
      if (isNotFound(error)) return { kind: "missing" };
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return this.quarantineUnknown(transferId, "invalid_state_json");
    }
    const state = parseState(value);
    if (!state) return this.quarantineUnknown(transferId, "unknown_or_invalid_schema");
    if (state.stateChecksumSha256 !== stateChecksum(state)) return this.quarantine(state, "state_checksum_mismatch");
    if (state.metadataHashSha256 !== metadataHash(state.metadata)) return this.quarantine(state, "metadata_hash_mismatch");
    let length: number;
    try {
      length = (await stat(this.partPath(transferId))).size;
    } catch (error) {
      if (isNotFound(error) && state.phase === "terminal") return { kind: "ready", state };
      return this.quarantine(state, "data_file_missing");
    }
    if (length < state.committedOffset) return this.quarantine(state, "state_ahead_of_data");
    if (length > state.committedOffset) await truncate(this.partPath(transferId), state.committedOffset);
    if (state.phase === "quarantined") return { kind: "quarantined", reason: state.quarantineReason ?? "quarantined" };
    return { kind: "ready", state };
  }

  async commitChunk(state: TransferSpoolState, data: Buffer, frame: CommittedFrame): Promise<TransferSpoolState> {
    const handle = await open(this.partPath(state.metadata.transferId), constants.O_WRONLY);
    try {
      const result = await handle.write(data, 0, data.length, frame.offsetBytes);
      if (result.bytesWritten !== data.length) throw new Error("short spool write");
      await this.onBoundary("data_written", state.metadata.transferId);
      await handle.sync();
      await this.onBoundary("data_synced", state.metadata.transferId);
    } finally {
      await handle.close();
    }
    const next = this.withChecksum({
      ...state,
      committedOffset: frame.offsetBytes + frame.lengthBytes,
      nextSequence: frame.seq + 1,
      frames: [...state.frames, frame],
      updatedAt: this.now().toISOString(),
    });
    await this.persistState(next);
    return next;
  }

  async update(state: TransferSpoolState, patch: Partial<Omit<TransferSpoolState, "schemaVersion" | "metadata" | "metadataHashSha256" | "stateChecksumSha256">>): Promise<TransferSpoolState> {
    const next = this.withChecksum({ ...state, ...patch, updatedAt: this.now().toISOString() });
    await this.persistState(next);
    return next;
  }

  async removePartial(state: TransferSpoolState): Promise<void> {
    if (state.phase !== "terminal" || state.terminalResult === null) throw new Error("partial data can only be removed after a durable terminal result");
    await rm(this.partPath(state.metadata.transferId), { force: true });
    await this.syncDirectory();
  }

  async garbageCollectTerminal(retainAfter: Date): Promise<number> {
    const { readdir } = await import("node:fs/promises");
    await mkdir(this.directory, { recursive: true });
    let removed = 0;
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith(".json")) continue;
      const transferId = name.slice(0, -5);
      const state = await this.readValidStateWithoutRecovery(transferId);
      if (!state || state.phase !== "terminal" || Date.parse(state.updatedAt) >= retainAfter.getTime()) continue;
      await rm(this.partPath(transferId), { force: true });
      await rm(this.statePath(transferId), { force: true });
      removed += 1;
    }
    if (removed > 0) await this.syncDirectory();
    return removed;
  }

  async allocatedBytes(): Promise<number> {
    const { readdir } = await import("node:fs/promises");
    await mkdir(this.directory, { recursive: true });
    let total = 0;
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith(".json")) continue;
      const transferId = name.slice(0, -5);
      if (!await this.readValidStateWithoutRecovery(transferId)) continue;
      const loaded = await this.load(transferId);
      if (loaded.kind === "ready" && loaded.state.phase !== "terminal") total += loaded.state.metadata.sizeBytes;
    }
    return total;
  }

  private async readValidStateWithoutRecovery(transferId: string): Promise<TransferSpoolState | null> {
    try {
      const value = JSON.parse(await readFile(this.statePath(transferId), "utf8")) as unknown;
      const state = parseState(value);
      return state && state.stateChecksumSha256 === stateChecksum(state) && state.metadataHashSha256 === metadataHash(state.metadata) ? state : null;
    } catch {
      return null;
    }
  }

  private async quarantineUnknown(transferId: string, reason: string): Promise<LoadResult> {
    const quarantinePath = `${this.statePath(transferId)}.quarantine`;
    try {
      await rename(this.statePath(transferId), quarantinePath);
      await this.syncDirectory();
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    return { kind: "quarantined", reason };
  }

  private async quarantine(state: TransferSpoolState, reason: string): Promise<LoadResult> {
    const quarantined = this.withChecksum({ ...state, phase: "quarantined", quarantineReason: reason, updatedAt: this.now().toISOString() });
    await this.persistState(quarantined);
    return { kind: "quarantined", reason };
  }

  private withChecksum(state: TransferSpoolState): TransferSpoolState {
    return { ...state, stateChecksumSha256: stateChecksum(state) };
  }

  private async persistState(state: TransferSpoolState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.statePath(state.metadata.transferId)}.tmp`;
    const handle = await open(temporary, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(JSON.stringify(state));
      await this.onBoundary("temp_state_written", state.metadata.transferId);
      await handle.sync();
      await this.onBoundary("temp_state_synced", state.metadata.transferId);
    } finally {
      await handle.close();
    }
    await rename(temporary, this.statePath(state.metadata.transferId));
    await this.onBoundary("state_renamed", state.metadata.transferId);
    await this.syncDirectory();
    await this.onBoundary("directory_synced", state.metadata.transferId);
  }

  private async syncDirectory(): Promise<void> {
    const handle = await open(this.directory, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export function digestBytes(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function metadataHash(metadata: TransferMetadata): string {
  return createHash("sha256").update(stableStringify(metadata)).digest("hex");
}

function stateChecksum(state: TransferSpoolState): string {
  const { stateChecksumSha256: _checksum, ...unsigned } = state;
  return createHash("sha256").update(stableStringify(unsigned)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseState(value: unknown): TransferSpoolState | null {
  if (!isTransferSpoolStateV1(value)) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "metadata", "metadataHashSha256", "stateChecksumSha256", "committedOffset", "nextSequence", "phase", "frames", "uploadIntent", "uploadResult", "startIntent", "startResult", "terminalResult", "quarantineReason", "updatedAt"]) || !isMetadata(value.metadata)) return null;
  if (!isSha256(value.metadataHashSha256) || !isSha256(value.stateChecksumSha256) || !nonNegativeInteger(value.committedOffset) || !nonNegativeInteger(value.nextSequence)) return null;
  if (!isPhase(value.phase) || !Array.isArray(value.frames) || !value.frames.every(isFrame)) return null;
  if (!nullableIntent(value.uploadIntent) || !nullableUploadResult(value.uploadResult) || !nullableIntent(value.startIntent) || !nullableStartResult(value.startResult)) return null;
  if (!nullableTerminal(value.terminalResult) || (value.quarantineReason !== null && typeof value.quarantineReason !== "string") || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  if (value.committedOffset > value.metadata.sizeBytes || value.frames.length !== value.nextSequence) return null;
  let expectedOffset = 0;
  for (let index = 0; index < value.frames.length; index += 1) {
    const frame = value.frames[index];
    if (!frame || frame.seq !== index || frame.offsetBytes !== expectedOffset) return null;
    expectedOffset += frame.lengthBytes;
  }
  if (expectedOffset !== value.committedOffset) return null;
  if (value.phase === "terminal" && value.terminalResult === null) return null;
  if (value.phase === "upload_intent" && value.uploadIntent === null) return null;
  if (value.phase === "start_intent" && (value.uploadResult === null || value.startIntent === null)) return null;
  return value;
}

function isMetadata(value: unknown): value is TransferMetadata {
  return isRecord(value) && hasExactKeys(value, ["transferId", "gatewayId", "deviceId", "fileName", "sizeBytes", "sha256", "objectVersion", "chunkSizeBytes", "startPrint", "kind"])
    && typeof value.transferId === "string" && typeof value.gatewayId === "string" && typeof value.deviceId === "string"
    && typeof value.fileName === "string" && nonNegativeInteger(value.sizeBytes) && isSha256(value.sha256) && typeof value.objectVersion === "string"
    && nonNegativeInteger(value.chunkSizeBytes) && typeof value.startPrint === "boolean" && (value.kind === "gcode" || value.kind === "printer_profile");
}

function isFrame(value: unknown): value is CommittedFrame {
  return isRecord(value) && hasExactKeys(value, ["seq", "offsetBytes", "lengthBytes", "digestSha256", "last"])
    && nonNegativeInteger(value.seq) && nonNegativeInteger(value.offsetBytes) && nonNegativeInteger(value.lengthBytes) && isSha256(value.digestSha256) && typeof value.last === "boolean";
}

function nullableIntent(value: unknown): boolean { return value === null || (isRecord(value) && hasExactKeys(value, ["attemptedAt"]) && typeof value.attemptedAt === "string" && Number.isFinite(Date.parse(value.attemptedAt))); }
function nullableUploadResult(value: unknown): boolean { return value === null || (isRecord(value) && typeof value.ok === "boolean" && (value.ok ? hasExactKeys(value, ["ok", "storedAs"]) && typeof value.storedAs === "string" : hasExactKeys(value, ["ok", "error"]) && typeof value.error === "string")); }
function nullableStartResult(value: unknown): boolean { return value === null || (isRecord(value) && typeof value.ok === "boolean" && (value.ok ? hasExactKeys(value, ["ok"]) : hasExactKeys(value, ["ok", "error"]) && typeof value.error === "string")); }
function nullableTerminal(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || value.type !== "file_result" || typeof value.device_id !== "string" || typeof value.transfer_id !== "string") return false;
  if (value.outcome === "stored") return hasExactKeys(value, ["type", "device_id", "transfer_id", "outcome", "stored_as"]) && typeof value.stored_as === "string";
  if (value.outcome !== "failed" || typeof value.error_code !== "string") return false;
  const allowed = ["type", "device_id", "transfer_id", "outcome", "error_code", "next_seq", "next_offset_bytes", "message"];
  const required = ["type", "device_id", "transfer_id", "outcome", "error_code"];
  return Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => key in value)
    && (value.next_seq === undefined || nonNegativeInteger(value.next_seq)) && (value.next_offset_bytes === undefined || nonNegativeInteger(value.next_offset_bytes))
    && (value.message === undefined || typeof value.message === "string");
}
function isPhase(value: unknown): value is TransferPhase { return typeof value === "string" && ["receiving", "upload_intent", "upload_complete", "start_intent", "terminal", "quarantined", "reconciliation_required"].includes(value); }
function isSha256(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function nonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isNotFound(error: unknown): boolean { return isRecord(error) && error.code === "ENOENT"; }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
