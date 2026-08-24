// Адаптер owner-scoped command/result API. Он не меняет direct-LAN чтение live state:
// команды и их подтверждённый результат остаются в API → relay/agent-контуре.

export type DeviceCommand = "start" | "pause" | "resume" | "stop" | "gcode";

const COMMAND_RESULT_KINDS = [
  "queued",
  "leased",
  "delivered",
  "acknowledged",
  "executed",
  "failed",
  "expired",
] as const;
type ConfirmedCommandResultKind = (typeof COMMAND_RESULT_KINDS)[number];
export type CommandResultKind = ConfirmedCommandResultKind | "offline";

export interface CommandResultState {
  kind: CommandResultKind;
  commandId: string;
  printerId: string;
  correlationId: string | null;
  command: DeviceCommand | null;
  code: string | null;
  message: string | null;
  timestamp: string | null;
}

export type CommandFailureReason =
  "not_available" | "rejected" | "server_error" | "network";
export type SafeCommandFailureCode =
  | "command_denied"
  | "safe_test_job_required"
  | "role_forbidden"
  | "unknown_command";
export type QueueResult =
  | { ok: true; commandId: string }
  | { ok: false; reason: CommandFailureReason; code?: SafeCommandFailureCode };

const API_URL = import.meta.env.VITE_API_URL ?? "";

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asDeviceCommand(value: unknown): DeviceCommand | null {
  return value === "start" ||
    value === "pause" ||
    value === "resume" ||
    value === "stop" ||
    value === "gcode"
    ? value
    : null;
}

function asSafeCommandFailureCode(
  value: unknown,
): SafeCommandFailureCode | null {
  return value === "command_denied" ||
    value === "safe_test_job_required" ||
    value === "role_forbidden" ||
    value === "unknown_command"
    ? value
    : null;
}

function offlineCommandResult(
  printerId: string,
  commandId: string,
): CommandResultState {
  return {
    kind: "offline",
    printerId,
    commandId,
    correlationId: null,
    command: null,
    code: null,
    message: "Не удалось получить итог команды. Повторите проверку.",
    timestamp: null,
  };
}

function isConfirmedCommandResultKind(
  value: unknown,
): value is ConfirmedCommandResultKind {
  return (
    typeof value === "string" &&
    (COMMAND_RESULT_KINDS as readonly string[]).includes(value)
  );
}

export function isTerminalCommandResult(result: CommandResultState): boolean {
  return (
    result.kind === "executed" ||
    result.kind === "failed" ||
    result.kind === "expired"
  );
}

export function queuedCommandResult(
  printerId: string,
  commandId: string,
  command: DeviceCommand,
): CommandResultState {
  return {
    kind: "queued",
    printerId,
    commandId,
    correlationId: null,
    command,
    code: null,
    message: null,
    timestamp: null,
  };
}

export function commandResultHref(
  printerId: string,
  commandId: string,
): string {
  const url = new URL(window.location.href);
  url.searchParams.set("printer_id", printerId);
  url.searchParams.set("command_id", commandId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function rememberCommandResult(
  printerId: string,
  commandId: string,
): string {
  const href = commandResultHref(printerId, commandId);
  window.history.replaceState(window.history.state, "", href);
  return href;
}

export async function fetchCommandResult(
  printerId: string,
  commandId: string,
): Promise<CommandResultState> {
  try {
    const response = await fetch(
      `${API_URL}/me/printers/${encodeURIComponent(printerId)}/commands/${encodeURIComponent(commandId)}`,
      {
        credentials: "include",
      },
    );
    if (!response.ok) return offlineCommandResult(printerId, commandId);
    const data = (await response.json()) as Record<string, unknown>;
    if (!isConfirmedCommandResultKind(data.status))
      return offlineCommandResult(printerId, commandId);
    return {
      kind: data.status,
      commandId: asStringOrNull(data.command_id) ?? commandId,
      printerId: asStringOrNull(data.device_id) ?? printerId,
      correlationId: asStringOrNull(data.correlation_id),
      command: asDeviceCommand(data.command),
      code: asStringOrNull(data.code),
      message: asStringOrNull(data.message),
      timestamp: asStringOrNull(data.timestamp),
    };
  } catch {
    return offlineCommandResult(printerId, commandId);
  }
}

export async function queueCommand(
  deviceId: string,
  command: DeviceCommand,
  payload?: Record<string, unknown>,
): Promise<QueueResult> {
  try {
    const response = await fetch(
      `${API_URL}/me/printers/${encodeURIComponent(deviceId)}/commands`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ command, ...payload }),
      },
    );
    const rawData: unknown = await response.json().catch(() => ({}));
    const data =
      rawData !== null && typeof rawData === "object" && !Array.isArray(rawData)
        ? (rawData as { id?: unknown; status?: unknown; error?: unknown })
        : {};
    if (response.status === 404) return { ok: false, reason: "not_available" };
    if (!response.ok) {
      const safeTestJobCode =
        payload?.safe_test_job === true
          ? asSafeCommandFailureCode(data.error)
          : null;
      return safeTestJobCode
        ? {
            ok: false,
            reason: response.status >= 500 ? "server_error" : "rejected",
            code: safeTestJobCode,
          }
        : {
            ok: false,
            reason: response.status >= 500 ? "server_error" : "rejected",
          };
    }
    if (
      response.status !== 202 ||
      data.status !== "queued" ||
      typeof data.id !== "string" ||
      !data.id
    ) {
      return { ok: false, reason: "server_error" };
    }
    return { ok: true, commandId: data.id };
  } catch {
    return { ok: false, reason: "network" };
  }
}
