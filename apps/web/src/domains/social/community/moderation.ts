import { API_URL } from "@shared/api";
const MODERATION_API = `${API_URL}/v1/community`;

export type ModerationTargetType = "post" | "thread" | "comment" | "model" | "make";
export type ModerationReasonCode = "illegal" | "copyright" | "spam" | "harassment" | "abuse" | "other";
export type ModerationActionType = "approve" | "hide" | "delete" | "restrict" | "sanction" | "dismiss";
export type ModerationFlagStatus = "open" | "assigned" | "resolved" | "dismissed" | "withdrawn";

export interface ModerationFlag {
  id: string;
  priority: number;
  due_at: string;
  subject: { type: ModerationTargetType; id: string; snapshot: Record<string, unknown> };
  reason_code: string;
  status: ModerationFlagStatus;
  evidence: Array<{ id: string; url: string; uploaded_at: string }>;
  claim: { id: string; moderator_id: string; claimed_at: string; expires_at: string } | null;
}

export interface CommunityRestriction {
  action: string;
  remaining?: number;
  reset_at?: string;
}

export const MODERATION_REASONS: ReadonlyArray<{ code: ModerationReasonCode; label: string }> = [
  { code: "illegal", label: "Нарушение закона или опасный контент" },
  { code: "copyright", label: "Нарушение прав" },
  { code: "spam", label: "Спам или мошенничество" },
  { code: "harassment", label: "Оскорбления или травля" },
  { code: "abuse", label: "Злоупотребление" },
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

export async function claimModerationFlag(id: string): Promise<{ id: string; status: ModerationFlagStatus }> {
  const result = await request<{ flag: { id: string; status: ModerationFlagStatus } }>(`/flags/${encodeURIComponent(id)}/claim`, mutation({}));
  return result.flag;
}

export async function decideModerationFlag(
  id: string,
  fields: { action: ModerationActionType; reason_code: ModerationReasonCode; reason_note: string },
): Promise<{ decision: { id: string; action: ModerationActionType } }> {
  return request(`/flags/${encodeURIComponent(id)}/decision`, mutation(fields));
}

export async function reverseModerationAction(actionId: string, reason: string): Promise<{ id: string; reversedAt: string | null }> {
  return request(`/moderation/actions/${encodeURIComponent(actionId)}/reversal`, mutation({ reason }));
}

export async function createModerationFlag(fields: {
  target: { type: ModerationTargetType; id: string };
  reason_code: ModerationReasonCode;
  details?: string;
}): Promise<{ id: string; status: ModerationFlagStatus; target: { type: ModerationTargetType; id: string } }> {
  const result = await request<{ flag: { id: string; status: ModerationFlagStatus; subjectType: ModerationTargetType; subjectId: string } }>("/flags", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
    body: JSON.stringify({ target: fields.target, reason_code: fields.reason_code, reason_text: fields.details }),
  });
  return { id: result.flag.id, status: result.flag.status, target: { type: result.flag.subjectType, id: result.flag.subjectId } };
}
