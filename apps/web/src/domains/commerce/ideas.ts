// Клиент связующего слоя «Идей» (MF-695, docs/design/feedback.entrypoints.md §6): пока только
// GET /ideas/mine под секцию «Мои идеи» профиля — сама лента/страница идей ещё не собрана
// (MF-562/MF-561 API), этот файл не претендует на их контракт, только на то, что нужно здесь.
//
// Строковые значения статуса/типа — зеркалят apps/api/src/ideas/contract.ts (MF-561/MF-690,
// docs/design/ideas.md §6): 8 статусов, «отклонена» на бэкенде — declined, не rejected.

import type { StatusTone } from "@shared/ui";

import { apiFetch } from "@shared/api";
import type { components } from "src/api/generated/openapi";

export type IdeaType = components["schemas"]["IdeaDto"]["type"];

export type IdeaStatus =
  | "proposed"
  | "under_review"
  | "planned"
  | "in_progress"
  | "done"
  | "declined"
  | "duplicate"
  | "archived";

export type IdeaSummary = components["schemas"]["IdeaDto"];

export type ListMyIdeasResult = components["schemas"]["IdeasPageDto"];

export async function listMyIdeas(params: { limit?: number; cursor?: string } = {}): Promise<ListMyIdeasResult | null> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const qs = query.toString();
  const response = await apiFetch(`/ideas/mine${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as ListMyIdeasResult;
}

// Категории идей (apps/api/src/ideas/contract.ts IDEA_CATEGORIES, docs/design/ideas.md §1.4) —
// зеркалим строковые значения дословно, подписи RU из спеки §1.4.
export type IdeaCategory = components["schemas"]["IdeaDto"]["category"];

export const IDEA_CATEGORY_LABELS: Record<IdeaCategory, string> = {
  catalog: "Каталог",
  projects: "Проекты",
  forum: "Форум",
  account: "ЛК",
  other: "Другое",
};

export type IdeaTab = "popular" | "new" | "trending";

// Карточка ленты `/issue` (docs/design/ideas.md §2/§10 «Payload карточки/списка»): в отличие от
// облегчённого IdeaSummary («Мои идеи» профиля) несёт body/автора/голосовалку — GET /ideas ещё не
// отдаёт `viewer_has_voted`/`is_author`/`author` (§10 «От Data» — не финализировано на момент
// сборки MF-945), поэтому они опциональны — экран деградирует к «гость»/«не голосовал», не падает.
export interface IdeaListItem {
  id: string;
  title: string;
  body: string;
  category: IdeaCategory;
  type: IdeaType;
  status: IdeaStatus;
  canonical_id: string | null;
  vote_count: number;
  decline_reason?: string | null;
  created_at: string;
  last_activity_at: string;
  author?: { username: string } | null;
  viewer_has_voted?: boolean;
  is_author?: boolean;
}

export interface ListIdeasResult {
  items: IdeaListItem[];
  next_cursor: string | null;
}

export interface ListIdeasParams {
  tab: IdeaTab;
  category?: IdeaCategory;
  status?: IdeaStatus;
  cursor?: string;
  limit?: number;
}

// Дискриминированный результат — экран (issuestore.ts) должен отличить «гость, 401» (мягкий гейт
// входа, ideas.md §1.6/§10 «Гость vs auth») от прочих ошибок сети/сервера («Не удалось загрузить»,
// §8), не гадая по одному null, как listMyIdeas выше.
export type ListIdeasOutcome =
  | { ok: true; result: ListIdeasResult }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "error" };

export async function listIdeas(params: ListIdeasParams): Promise<ListIdeasOutcome> {
  const query = new URLSearchParams();
  query.set("tab", params.tab);
  if (params.category) query.set("category", params.category);
  if (params.status) query.set("status", params.status);
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? 20));
  let response: Response;
  try {
    response = await apiFetch(`/ideas?${query.toString()}`, { credentials: "include" });
  } catch {
    return { ok: false, reason: "error" };
  }
  if (response.status === 401) return { ok: false, reason: "unauthorized" };
  if (!response.ok) return { ok: false, reason: "error" };
  return { ok: true, result: (await response.json()) as ListIdeasResult };
}

// Тоггл голоса (docs/design/ideas.md §5/§10 «POST /ideas/:id/vote… ответ {vote_count,
// viewer_has_voted}, под оптимистичный откат» — зеркалит существующий `models/vote.ts`). Экран
// не различает «первый голос»/«отзыв» — эндпоинт сам решает по текущему состоянию (toggle),
// UI (ui/vote.tsx Vote) уже держит свой оптимистичный count локально, здесь только подтверждение
// или отказ (`false` → компонент откатывает сам).
export async function voteIdea(id: string): Promise<{ vote_count: number; viewer_has_voted: boolean } | false> {
  try {
    const response = await apiFetch(`/ideas/${encodeURIComponent(id)}/vote`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) return false;
    return (await response.json()) as { vote_count: number; viewer_has_voted: boolean };
  } catch {
    return false;
  }
}

// Маппинг 8 статусов на палитру (docs/design/ideas.md §6, «яркость=важность»): нарастание
// мягкой яркости level 1..4 к «готово», коралл — только «отклонена», остальное — dim.
export const IDEA_STATUS_META: Record<
  IdeaStatus,
  { label: string; tone: StatusTone; level?: 1 | 2 | 3 | 4; done?: boolean }
> = {
  proposed: { label: "Предложена", tone: "dim" },
  under_review: { label: "На рассмотрении", tone: "ok", level: 1 },
  planned: { label: "Запланирована", tone: "ok", level: 2 },
  in_progress: { label: "В работе", tone: "ok", level: 3 },
  done: { label: "Готово", tone: "ok", level: 4, done: true },
  declined: { label: "Отклонена", tone: "danger" },
  duplicate: { label: "Дубликат", tone: "dim" },
  archived: { label: "В архиве", tone: "dim" },
};