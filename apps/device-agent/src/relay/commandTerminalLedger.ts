import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CommandResultFrame } from "./protocol.ts";
import { parseGatewayToRelayFrame } from "./protocol-v1.ts";

export type CommandTerminalResult = CommandResultFrame;

export interface CommandTerminalLedgerEntry {
  deviceId: string;
  commandId: string;
  sequence: number;
  result: CommandTerminalResult;
}

export type CommandLedgerLookup = { status: "missing" } | { status: "match"; result: CommandTerminalResult } | { status: "conflict" };

export interface CommandTerminalLedger {
  lookup(deviceId: string, commandId: string, sequence: number): CommandLedgerLookup;
  lastSequence(deviceId: string): number | undefined;
  acceptSequence(deviceId: string, sequence: number): void;
  record(entry: CommandTerminalLedgerEntry): void;
}

interface LedgerDocument {
  version: 1;
  lastSequenceByDevice: Record<string, number>;
  entries: CommandTerminalLedgerEntry[];
}

export class CommandLedgerCorruptError extends Error {
  constructor(path: string) {
    super(`command terminal ledger is invalid: ${path}`);
    this.name = "CommandLedgerCorruptError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseResult(value: unknown, deviceId: string, commandId: string): CommandTerminalResult | null {
  const parsed = parseGatewayToRelayFrame(JSON.stringify(value));
  if (!parsed.ok || parsed.frame.type !== "command_result") return null;
  if (parsed.frame.device_id !== deviceId || parsed.frame.command_id !== commandId) return null;
  return parsed.frame;
}

function parseDocument(value: unknown): LedgerDocument | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.lastSequenceByDevice) || !Array.isArray(value.entries)) return null;

  const lastSequenceByDevice: Record<string, number> = {};
  for (const [deviceId, sequence] of Object.entries(value.lastSequenceByDevice)) {
    if (!isNonEmptyString(deviceId) || !isSequence(sequence)) return null;
    lastSequenceByDevice[deviceId] = sequence;
  }

  const entries: CommandTerminalLedgerEntry[] = [];
  const commandIds = new Set<string>();
  for (const candidate of value.entries) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.deviceId) || !isNonEmptyString(candidate.commandId) || !isSequence(candidate.sequence)) return null;
    if (commandIds.has(candidate.commandId)) return null;
    const result = parseResult(candidate.result, candidate.deviceId, candidate.commandId);
    if (!result || result.command_seq !== candidate.sequence) return null;
    commandIds.add(candidate.commandId);
    entries.push({
      deviceId: candidate.deviceId,
      commandId: candidate.commandId,
      sequence: candidate.sequence,
      result,
    });
  }

  return { version: 1, lastSequenceByDevice, entries };
}

export class InMemoryCommandTerminalLedger implements CommandTerminalLedger {
  protected readonly entries = new Map<string, CommandTerminalLedgerEntry>();
  protected readonly lastSequenceByDevice = new Map<string, number>();

  constructor(protected readonly maxEntries = 1000) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error("command terminal ledger maxEntries must be a positive integer");
  }

  lookup(deviceId: string, commandId: string, sequence: number): CommandLedgerLookup {
    const entry = this.entries.get(commandId);
    if (!entry) return { status: "missing" };
    if (entry.deviceId !== deviceId || entry.sequence !== sequence) return { status: "conflict" };
    return { status: "match", result: entry.result };
  }

  lastSequence(deviceId: string): number | undefined {
    return this.lastSequenceByDevice.get(deviceId);
  }

  acceptSequence(deviceId: string, sequence: number): void {
    const previous = this.lastSequenceByDevice.get(deviceId);
    if (previous === undefined || sequence > previous) this.lastSequenceByDevice.set(deviceId, sequence);
    this.persist();
  }

  record(entry: CommandTerminalLedgerEntry): void {
    const existing = this.entries.get(entry.commandId);
    if (existing && (existing.deviceId !== entry.deviceId || existing.sequence !== entry.sequence)) {
      throw new Error("command terminal ledger identity conflict");
    }
    if (existing) {
      if (JSON.stringify(existing.result) !== JSON.stringify(entry.result)) throw new Error("command terminal ledger result conflict");
      return;
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(entry.commandId, entry);
    this.persist();
  }

  protected persist(): void {}
}

export class FileCommandTerminalLedger extends InMemoryCommandTerminalLedger {
  constructor(
    private readonly path: string,
    maxEntries = 1000,
  ) {
    super(maxEntries);
    this.load();
  }

  protected override persist(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    const document: LedgerDocument = {
      version: 1,
      lastSequenceByDevice: Object.fromEntries(this.lastSequenceByDevice),
      entries: [...this.entries.values()],
    };
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporaryPath, "w", 0o600);
      writeSync(descriptor, `${JSON.stringify(document)}\n`);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.path);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Nothing to clean up when the temporary file was never created.
      }
      throw error;
    }
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
    } catch {
      throw new CommandLedgerCorruptError(this.path);
    }
    const document = parseDocument(parsed);
    if (!document || document.entries.length > this.maxEntries) throw new CommandLedgerCorruptError(this.path);
    for (const [deviceId, sequence] of Object.entries(document.lastSequenceByDevice)) this.lastSequenceByDevice.set(deviceId, sequence);
    for (const entry of document.entries) this.entries.set(entry.commandId, entry);
  }
}

export function commandTerminalLedgerPath(agentHome: string): string {
  return join(agentHome, "command-terminal-ledger.v1.json");
}
