import type { StatusLevel, StatusTone } from "@shared/ui";

// Клиент страницы идеи `/issue/:id` (docs/design/ideas.md §3/§10, MF-946). Контракт зеркалит
// apps/api/src/ideas/{detail,comments,vote}.ts (голые fetch-обёртки, тот же приём, что
// community/api.ts — в репо нет генерируемого клиента).

import { apiFetch } from "@shared/api";
import type { components } from "../../../api/generated/openapi";

export const IDEA_COMMENT_MAX_LENGTH = 5_000;

export type IdeaComment = components["schemas"]["IdeaCommentResponseDto"];

// IdeaDetailDto не содержит assignee_type (ещё не задеплоен бэком, MF-946) —
// расширяем через intersection, чтобы AgentBadge мог читать поле когда оно появится.
export type IdeaDetail = components["schemas"]["IdeaDetailDto"] & { assignee_type?: string };

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export class IdeaApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string } | null;
    return body?.error ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function getIdea(id: string): Promise<IdeaDetail | null> {
  const response = await apiFetch(`/ideas/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as IdeaDetail;
}

export async function listIdeaComments(id: string, cursor?: string, limit?: number) {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (limit) query.set("limit", String(limit));
  const qs = query.toString();
  const response = await apiFetch(`/ideas/${encodeURIComponent(id)}/comments${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as components["schemas"]["IdeaCommentsResponseDto"];
}

export async function postIdeaComment(id: string, body: string): Promise<IdeaComment> {
  const response = await apiFetch(`/ideas/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new IdeaApiError(await readErrorCode(response));
  return (await response.json()) as components["schemas"]["IdeaCommentResponseDto"];
}

export interface IdeaVoteResult {
  vote_count: number;
  viewer_has_voted: boolean;
}

export async function toggleIdeaVote(id: string): Promise<IdeaVoteResult | null> {
  const response = await apiFetch(`/ideas/${encodeURIComponent(id)}/vote`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as IdeaVoteResult;
}

// Маппинг 8 статусов идеи на палитру StatusPill (docs/design/ideas.md §6) — «яркость=важность»,
// нарастание мятного к «готово», коралл только у «отклонена», dim у дубликата/архива. Строковые
// enum-значения зеркалят apps/api/src/ideas/contract.ts::IDEA_STATUSES.
export interface IdeaStatusMeta {
  label: string;
  tone: StatusTone;
  level?: StatusLevel;
  done?: boolean;
}

export const IDEA_STATUS_META: Record<string, IdeaStatusMeta> = {
  proposed: { label: "Предложена", tone: "dim" },
  under_review: { label: "На рассмотрении", tone: "ok", level: 1 },
  planned: { label: "Запланирована", tone: "ok", level: 2 },
  in_progress: { label: "В работе", tone: "ok", level: 3 },
  done: { label: "Готово", tone: "ok", level: 4, done: true },
  declined: { label: "Отклонена", tone: "danger" },
  duplicate: { label: "Дубликат", tone: "dim" },
  archived: { label: "В архиве", tone: "dim" },
};

export function ideaStatusMeta(status: string): IdeaStatusMeta {
  return IDEA_STATUS_META[status] ?? { label: status, tone: "dim" };
}

const CATEGORY_LABELS: Record<string, string> = {
  catalog: "Каталог",
  projects: "Проекты",
  forum: "Форум",
  account: "ЛК",
  other: "Другое",
};

export function ideaCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}