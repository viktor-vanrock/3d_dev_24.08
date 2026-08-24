export const CONNECTION_MODES = ["list", "managed-local", "managed-bridge"] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export const LIVE_AVAILABILITY_REASONS = ["available", "no_telemetry_channel", "offline", "stale", "permission_denied", "server_error"] as const;
export type LiveAvailabilityReason = (typeof LIVE_AVAILABILITY_REASONS)[number];

export const COMMAND_CAPABILITY_NAMES = ["gcode", "start", "pause", "resume", "stop", "cancel"] as const;
export type CommandCapabilityName = (typeof COMMAND_CAPABILITY_NAMES)[number];
export type CommandCapabilities = Record<CommandCapabilityName, boolean>;

export const DEVICE_STATE_STALE_AFTER_MS = 45_000;

export interface PrinterOperatingRow {
  connection_mode: unknown;
  link_source: unknown;
  agent_id: string | null;
  agent_revoked_at: Date | string | null;
  state_status: string | null;
  state_updated_at: Date | string | null;
  capabilities: unknown;
}

export interface OperatingState {
  connection_mode: ConnectionMode;
  live_availability_reason: LiveAvailabilityReason;
  last_confirmed_at: string | null;
  command_capabilities: CommandCapabilities;
}

function isConnectionMode(value: unknown): value is ConnectionMode {
  return typeof value === "string" && (CONNECTION_MODES as readonly string[]).includes(value);
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function confirmedCommands(value: unknown): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Set();
  const raw = value as Record<string, unknown>;
  const source = raw.commands ?? raw.supported_commands ?? raw.supportedCommands;
  if (Array.isArray(source)) return new Set(source.filter((item): item is string => typeof item === "string"));
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return new Set(
      Object.entries(source)
        .filter(([, enabled]) => enabled === true)
        .map(([name]) => name),
    );
  }
  return new Set();
}

export function resolveConnectionMode(connectionMode: unknown, linkSource: unknown): ConnectionMode {
  if (isConnectionMode(connectionMode)) return connectionMode;
  if (linkSource === "ip") return "managed-local";
  if (linkSource === "agent") return "managed-bridge";
  return "list";
}

export function resolveCommandCapabilities(value: unknown): CommandCapabilities {
  const confirmed = confirmedCommands(value);
  return Object.fromEntries(COMMAND_CAPABILITY_NAMES.map((name) => [name, confirmed.has(name)])) as CommandCapabilities;
}

export function resolveOperatingState(row: PrinterOperatingRow, now = new Date()): OperatingState {
  const connectionMode = resolveConnectionMode(row.connection_mode, row.link_source);
  const stateUpdatedAt = asIso(row.state_updated_at);
  let reason: LiveAvailabilityReason;

  if (connectionMode === "managed-local" || connectionMode === "list") {
    reason = "no_telemetry_channel";
  } else if (row.agent_revoked_at !== null) {
    reason = "permission_denied";
  } else if (!row.agent_id || !stateUpdatedAt) {
    reason = "no_telemetry_channel";
  } else if (row.state_status === "offline") {
    reason = "offline";
  } else if (now.getTime() - new Date(stateUpdatedAt).getTime() > DEVICE_STATE_STALE_AFTER_MS) {
    reason = "stale";
  } else {
    reason = "available";
  }

  return {
    connection_mode: connectionMode,
    live_availability_reason: reason,
    last_confirmed_at: reason === "no_telemetry_channel" ? null : stateUpdatedAt,
    // managed-local не имеет server-side Fleet confirmation: браузерный LAN-канал
    // не превращается в удалённые команды даже если в старой jsonb-строке остались
    // capability-поля другого источника.
    command_capabilities: connectionMode === "managed-bridge" ? resolveCommandCapabilities(row.capabilities) : resolveCommandCapabilities(null),
  };
}
