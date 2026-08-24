export const NORMALIZED_COMMAND_STATUSES = ["queued", "leased", "delivered", "acknowledged", "executed", "failed", "expired"] as const;
export type NormalizedCommandStatus = (typeof NORMALIZED_COMMAND_STATUSES)[number];

type CommandResultPayload = Record<string, unknown> | null;

export interface CommandResultRow {
  id: string;
  correlation_id: string;
  raw_status: string;
  result: CommandResultPayload;
  created_at: Date;
  acked_at: Date | null;
}

export interface NormalizedCommandResult {
  command_id: string;
  correlation_id: string;
  status: NormalizedCommandStatus;
  code: string | null;
  message: string | null;
  timestamp: string;
}

const SAFE_MESSAGES: Record<string, string> = {
  capability_unconfirmed: "Возможность команды не подтверждена.",
  command_denied: "Команда отклонена политикой устройства.",
  command_failed: "Команда не выполнена.",
  command_expired: "Срок доставки команды истёк.",
  "command.ack_timeout": "Подтверждение команды не получено вовремя.",
  device_offline: "Устройство не подключено.",
  device_not_owned: "Устройство не принадлежит этой сессии.",
  driver_error: "Драйвер устройства отклонил команду.",
  invalid_command: "Команда отклонена как недействительная.",
  moonraker_unavailable: "Драйвер принтера недоступен.",
  relay_unavailable: "Канал устройства недоступен.",
  sequence_replay: "Команда отклонена как повтор.",
  token_expired: "Срок действия токена команды истёк.",
  token_invalid: "Токен команды недействителен.",
};

function safeCode(value: unknown): string {
  return typeof value === "string" && value in SAFE_MESSAGES ? value : "command_failed";
}

function safeOutcome(result: CommandResultPayload): { status?: string; code: string | null; message: string | null } {
  const explicitStatus = typeof result?.status === "string" ? result.status : undefined;
  const rawCode = result?.error_code ?? result?.code;
  if (!explicitStatus && rawCode === undefined) return { code: null, message: null };
  const code = safeCode(rawCode);
  return { status: explicitStatus, code, message: SAFE_MESSAGES[code] ?? null };
}

export function normalizeCommandResult(row: CommandResultRow): NormalizedCommandResult {
  const outcome = safeOutcome(row.result);
  const status: NormalizedCommandStatus = (NORMALIZED_COMMAND_STATUSES as readonly string[]).includes(row.raw_status) ? (row.raw_status as NormalizedCommandStatus) : "failed";

  const hasFailure = status === "failed" || status === "expired";
  return {
    command_id: row.id,
    correlation_id: row.correlation_id,
    status,
    code: hasFailure ? (outcome.code ?? "command_failed") : null,
    message: hasFailure ? (outcome.message ?? SAFE_MESSAGES.command_failed!) : null,
    timestamp: (row.acked_at ?? row.created_at).toISOString(),
  };
}

export function normalizeRelayResult(input: { ok: boolean; status?: unknown; error_code?: unknown; code?: unknown }): {
  ok: boolean;
  status: NormalizedCommandStatus;
  error_code: string | null;
  message: string | null;
} {
  const explicitStatus = typeof input.status === "string" ? input.status : undefined;
  const rawStatus = input.ok ? (explicitStatus === "executed" ? "executed" : "acknowledged") : "failed";
  const outcome = safeOutcome({ status: explicitStatus, error_code: input.error_code, code: input.code });
  const normalized = normalizeCommandResult({
    id: "internal",
    correlation_id: "internal",
    raw_status: rawStatus,
    result: { status: explicitStatus, error_code: input.error_code, code: input.code },
    created_at: new Date(0),
    acked_at: new Date(0),
  });
  return {
    ok: input.ok,
    status: normalized.status,
    error_code: normalized.code,
    message: normalized.message ?? outcome.message ?? null,
  };
}
