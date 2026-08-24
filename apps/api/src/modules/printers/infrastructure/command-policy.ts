export const PRINTER_COMMAND_POLICY_ERRORS = ["LAN_FORBIDDEN", "DEVICE_OFFLINE", "CAPABILITY_UNSUPPORTED"] as const;
export type PrinterCommandPolicyError = (typeof PRINTER_COMMAND_POLICY_ERRORS)[number];

export const PRINTER_COMMAND_STALE_AFTER_MS = 45_000;

export interface PrinterCommandPolicyInput {
  command: string;
  connectionMode: unknown;
  linkSource: unknown;
  agentId: string | null;
  agentStatus: unknown;
  agentRevokedAt: Date | string | null;
  agentLastSeenAt: Date | string | null;
  deviceLastSeenAt: Date | string | null;
  deviceStatus: unknown;
  capabilities: unknown;
  now?: Date;
}

export type PrinterCommandPolicyResult = { allowed: true } | { allowed: false; error: PrinterCommandPolicyError };

export function printerCommandPolicyStatus(error: PrinterCommandPolicyError): 403 | 409 {
  return error === "DEVICE_OFFLINE" ? 409 : 403;
}

function asTime(value: Date | string | null): number | null {
  if (value === null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isFresh(value: Date | string | null, now: number): boolean {
  const timestamp = asTime(value);
  return timestamp !== null && now - timestamp <= PRINTER_COMMAND_STALE_AFTER_MS;
}

function declaredCommands(value: unknown): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Set();
  const record = value as Record<string, unknown>;
  const source = record.supportedCommands ?? record.supported_commands ?? record.commands;
  if (Array.isArray(source)) {
    return new Set(source.filter((command): command is string => typeof command === "string"));
  }
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return new Set(
      Object.entries(source)
        .filter(([, enabled]) => enabled === true)
        .map(([command]) => command),
    );
  }
  return new Set();
}

/**
 * Fail-closed gate for cloud-to-device commands.
 * managed-local is browser→Moonraker only; this function never resolves a LAN endpoint.
 */
export function evaluatePrinterCommand(input: PrinterCommandPolicyInput): PrinterCommandPolicyResult {
  const bridge = input.connectionMode === "managed-bridge" || (input.connectionMode === null && input.linkSource === "agent");
  if (!bridge || input.linkSource !== "agent" || !input.agentId) {
    return { allowed: false, error: "LAN_FORBIDDEN" };
  }

  const now = (input.now ?? new Date()).getTime();
  if (
    input.agentRevokedAt !== null ||
    input.agentStatus !== "online" ||
    input.deviceStatus === "offline" ||
    !isFresh(input.agentLastSeenAt, now) ||
    !isFresh(input.deviceLastSeenAt, now)
  ) {
    return { allowed: false, error: "DEVICE_OFFLINE" };
  }

  if (!declaredCommands(input.capabilities).has(input.command)) {
    return { allowed: false, error: "CAPABILITY_UNSUPPORTED" };
  }

  return { allowed: true };
}
