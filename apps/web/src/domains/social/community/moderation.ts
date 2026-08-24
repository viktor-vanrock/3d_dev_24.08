import { API_URL } from "@shared/api";
const MODERATION_API = `${API_URL}/v1/community`;

export type ModerationTargetType = "post" | "thread";
export type ModerationReasonCode = "illegal_or_dangerous" | "copyright" | "spam_or_fraud" | "harassment" | "other";
export type ModerationActionType = "hide" | "restore" | "lock_thread" | "unlock_thread" | "reject_flag";
export type ModerationFlagStatus = "open" | "in_review" | "actioned" | "rejected" | "withdrawn";

export interface ModerationFlag {
  id: string;
  target: { type: ModerationTargetType; id: string };
  reason_code: string;
  status: ModerationFlagStatus;
  created_at: string;
  updated_at?: string;
  appeal?: { status: "pending" | "restored" | "upheld"; reason_code?: string };
}

export interface CommunityRestriction {
  action: string;
  remaining?: number;
  reset_at?: string;
}

export const MODERATION_REASONS: ReadonlyArray<{ code: ModerationReasonCode; label: string }> = [
  { code: "illegal_or_dangerous", label: "Нарушение закона или опасный контент" },
  { code: "copyright", label: "Нарушение прав" },
  { code: "spam_or_fraud", label: "Спам или мошенничество" },
  { code: "harassment", label: "Оскорбления или травля" },
  { code: "other", label: "Другое" },
];

const REASON_LABELS = new Map<string, string>(MODERATION_REASONS.map(({ code, label }) => [code, label]));

export function moderationReasonLabel(code: string | null | undefined): string {
  return (code && REASON_LABELS.get(code)) ?? "Причина указана модератором";
}

export class ModerationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
  }
}

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "00000000-0000-4000-8000-000000000000";
}

async function errorFrom(response: Response): Promise<ModerationApiError> {
  let code = "UNKNOWN";
  try {
    const body = (await response.json()) as { error?: string | { code?: string } };
    code = typeof body.error === "string" ? body.error : body.error?.code ?? code;
  } catch {
    // Ответ без JSON всё равно получает безопасный общий текст на UI.
  }
  const retryAfter = Number(response.headers.get("Retry-After"));
  return new ModerationApiError(response.status, code, Number.isFinite(retryAfter) ? retryAfter : null);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${MODERATION_API}${path}`, {
    credentials: "include",
    ...init,
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

function mutation(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
    body: JSON.stringify(body),
  };
}

export async function loadModerationQueue(): Promise<ModerationFlag[]> {
  const result = await request<{ items: ModerationFlag[] }>("/moderation/queue?status=open");
  return result.items;
}

// restrictions[] — серверный источник состояния TL0. Значения лимитов намеренно не дублируются
// в web: контракт может менять политику без выпуска нового интерфейса.
export async function loadCommunityRestrictions(): Promise<CommunityRestriction[]> {
  const result = await request<{ restrictions?: CommunityRestriction[] }>("/restrictions");
  return result.restrictions ?? [];
}

export async function claimModerationFlag(id: string): Promise<Pick<ModerationFlag, "id" | "status" | "updated_at">> {
  const result = await request<{ flag: Pick<ModerationFlag, "id" | "status" | "updated_at"> }>(`/flags/${encodeURIComponent(id)}/claim`, mutation({}));
  return result.flag;
}

export async function decideModerationFlag(
  id: string,
  fields: { action_type: ModerationActionType; reason_code: ModerationReasonCode; details: string },
): Promise<{ action: { id: string; type: ModerationActionType; status: "applied" | "reversed" }; flag: { id: string; status: ModerationFlagStatus } }> {
  return request(`/flags/${encodeURIComponent(id)}/decision`, mutation(fields));
}

export async function reverseModerationAction(actionId: string, reason: string): Promise<{ id: string; status: "reversed" }> {
  return request(`/moderation/actions/${encodeURIComponent(actionId)}/reversal`, mutation({ reason }));
}

export async function createModerationFlag(fields: {
  target: { type: ModerationTargetType; id: string };
  reason_code: ModerationReasonCode;
  details?: string;
}): Promise<{ id: string; status: ModerationFlagStatus; target: { type: ModerationTargetType; id: string; visibility?: "visible" | "hidden" } }> {
  const clientRequestId = requestId();
  return request("/flags", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": clientRequestId },
    body: JSON.stringify({ schema_version: "v1", ...fields, client_request_id: clientRequestId }),
  });
}
