import type { SessionUser } from "@shared/types";

// Клиент форума (docs/design/community.md, MF-35 Фаза 2): сообщества → треды → посты.
// Контракт зеркалит apps/api/src/community/* (коммит c534952) — тот же приём, что
// market/models.ts: голые fetch-обёртки, без генерируемого клиента (в репо такого нет вообще).

import { apiFetch } from "@shared/api";
import type { components } from "src/api/generated/openapi";

export type CommunityKind = "machine" | "vendor" | "craft" | "custom";
export type CommunityRole = "member" | "moderator" | "owner";
export type CommunityVisibility = "public" | "unlisted";
export type ThreadType = "discussion" | "question";
export type PostKind = "answer" | "reply" | "comment";

export const COMMUNITY_NAME_MAX_LENGTH = 120;
export const COMMUNITY_DESCRIPTION_MAX_LENGTH = 4000;
export const THREAD_TITLE_MAX_LENGTH = 200;
export const THREAD_CONTENT_MAX_LENGTH = 20_000;
export const THREAD_MAX_TAGS = 5;
export const POST_CONTENT_MAX_LENGTH = 20_000;

export type Community = components["schemas"]["CommunityDetailDto"];
export type Thread = components["schemas"]["ThreadViewDto"];
export type Post = components["schemas"]["PostViewDto"];
export type ThreadDetail = components["schemas"]["ThreadDetailDto"];

export interface VoteResult {
  votes_up: number;
  votes_down: number;
  my_vote: -1 | 0 | 1;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

// Мутации с валидацией (создание/публикация) — код ошибки нужен вызывающей стороне для маппинга
// в RU-текст (community.md §6), тот же приём, что market/models.ts::UploadError/AuxFileError.
export class CommunityApiError extends Error {
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

export async function listCommunities(
  params: { kind?: CommunityKind; q?: string; cursor?: string; limit?: number } = {},
): Promise<CursorPage<Community> | null> {
  const query = new URLSearchParams();
  if (params.kind) query.set("kind", params.kind);
  if (params.q) query.set("q", params.q);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  const response = await apiFetch(`/communities${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as CursorPage<Community>;
}

export async function createCommunity(fields: {
  name: string;
  description?: string;
  visibility?: CommunityVisibility;
}): Promise<Community> {
  const response = await apiFetch(`/communities`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new CommunityApiError(await readErrorCode(response));
  return (await response.json()) as Community;
}

export async function getCommunity(idOrSlug: string): Promise<Community | null> {
  const response = await apiFetch(`/communities/${encodeURIComponent(idOrSlug)}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as Community;
}

export async function joinCommunity(id: string): Promise<boolean> {
  const response = await apiFetch(`/communities/${encodeURIComponent(id)}/join`, {
    method: "POST",
    credentials: "include",
  });
  return response.ok;
}

export async function leaveCommunity(id: string): Promise<true | { error: string }> {
  const response = await apiFetch(`/communities/${encodeURIComponent(id)}/leave`, {
    method: "POST",
    credentials: "include",
  });
  if (response.ok) return true;
  return { error: await readErrorCode(response) };
}

// Источник подписки/отписки (MF-823, событие community_subscribe) — зеркалит
// apps/api/src/community/contract.ts::SUBSCRIBE_SOURCES. join/leave выше — историческая пара
// MF-415, которая НЕ эмитит community_subscribe (только /subscribe POST/DELETE, membership.ts);
// unsubscribeCommunity ниже — та ручка, которую зовёт «Отписаться» ленты (MF-980), чтобы отписка
// реально попадала в воронку MF-808, а не терялась молча.
export type SubscribeSource = "feed_left" | "feed_right" | "printer_connection" | "community_page";

// Подписка через актуальный контракт MF-767/MF-421 (не historical join выше) — эмитит
// community_subscribe на бэке (membership.ts#registerCommunitySubscribe), тот же приём, что
// unsubscribeCommunity ниже для «Отписаться».
export async function subscribeCommunity(id: string, source: SubscribeSource): Promise<true | { error: string }> {
  const response = await apiFetch(`/communities/${encodeURIComponent(id)}/subscribe`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (response.ok) return true;
  return { error: await readErrorCode(response) };
}

export async function unsubscribeCommunity(id: string, source: SubscribeSource): Promise<true | { error: string }> {
  const response = await apiFetch(`/communities/${encodeURIComponent(id)}/subscribe`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (response.ok) return true;
  return { error: await readErrorCode(response) };
}

export async function listThreads(
  communityId: string,
  params: { type?: ThreadType; cursor?: string; limit?: number } = {},
): Promise<CursorPage<Thread> | null> {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  const response = await apiFetch(`/communities/${encodeURIComponent(communityId)}/threads${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as CursorPage<Thread>;
}

export async function createThread(
  communityId: string,
  fields: { type: ThreadType; title: string; content: string; tags?: string[] },
): Promise<Thread> {
  const response = await apiFetch(`/communities/${encodeURIComponent(communityId)}/threads`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new CommunityApiError(await readErrorCode(response));
  return (await response.json()) as Thread;
}

export async function getThread(id: string): Promise<ThreadDetail | null> {
  const response = await apiFetch(`/threads/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as ThreadDetail;
}

export async function createPost(
  threadId: string,
  fields: { kind: PostKind; content: string; parent_post_id?: string },
): Promise<Post> {
  const response = await apiFetch(`/threads/${encodeURIComponent(threadId)}/posts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new CommunityApiError(await readErrorCode(response));
  return (await response.json()) as Post;
}

// Тот же контракт {votes_up,votes_down,my_vote}, что models.ts#voteModel/feed/api.ts#voteFeedPost —
// подключаются в VoteArrows (feed/vote.tsx) как третий/четвёртый subjectType (community.md §7.4).
export async function voteThread(id: string, value: -1 | 0 | 1): Promise<VoteResult | null> {
  const response = await apiFetch(`/threads/${encodeURIComponent(id)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) return null;
  return (await response.json()) as VoteResult;
}

export async function votePost(id: string, value: -1 | 0 | 1): Promise<VoteResult | null> {
  const response = await apiFetch(`/posts/${encodeURIComponent(id)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) return null;
  return (await response.json()) as VoteResult;
}

export async function acceptPost(threadId: string, postId: string | null): Promise<{ accepted_post_id: string | null } | null> {
  const response = await apiFetch(`/threads/${encodeURIComponent(threadId)}/accept`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: postId }),
  });
  if (!response.ok) return null;
  return (await response.json()) as { accepted_post_id: string | null };
}

// GAP-API (заявка Back, апрос комментом в карточке MF-931): треды/посты отдают только `author_id`,
// без join на users (в отличие от market/models.ts#ModelComment.author — там Back джойнит username/
// display_name/avatar_url). Нет и bulk-ручки users?ids=. Честный фолбэк: свою реплику узнаём по
// сессии, чужую подписываем нейтрально — не подделываем ник, которого не знаем.
export function authorDisplayName(authorId: string, viewer: SessionUser | null): string {
  if (viewer && authorId === viewer.id) return `@${viewer.username}`;
  return "Участник";
}

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// roundMemberCount (contract.ts) отдаёт СТРОКУ даже для точных малых чисел (<10 — "1".."9", без
// "+"), не только для округлённых "100+"/"1k+" — типом отличить нельзя, поэтому парсим: со
// знаком "+" склонять нечего (открытый диапазон, безопасный дефолт — множественное число),
// иначе строка — точное число, склоняем по нему, как и обычный number-кейс.
export function formatMemberCount(count: number | string): string {
  if (typeof count === "string") {
    if (count.endsWith("+")) return `${count} участников`;
    const exact = Number(count);
    if (Number.isFinite(exact)) return `${exact} ${pluralizeRu(exact, "участник", "участника", "участников")}`;
    return `${count} участников`;
  }
  return `${count} ${pluralizeRu(count, "участник", "участника", "участников")}`;
}

// Численная оценка member_count для клиентской сортировки (feed.md §1.3 п.3, «Каталог фидов» —
// 8 строк по числу подписчиков) — GET /communities отдаёт только created_at desc (communities.ts),
// сортировки по подписчикам на бэке нет, поэтому берём батч и сортируем на клиенте, тем же приёмом,
// что upcomingReleases в feedscreen.tsx. "100+"/"1k+" (roundMemberCount, contract.ts) — нижняя
// граница округлённого диапазона: различить 100 и 150 нельзя, но относительный порядок сохраняется.
export function communityMemberCountValue(count: number | string): number {
  if (typeof count === "number") return count;
  if (typeof count !== "string") return 0;
  const withoutPlus = count.endsWith("+") ? count.slice(0, -1) : count;
  if (withoutPlus.endsWith("k")) return Number(withoutPlus.slice(0, -1)) * 1000;
  const parsed = Number(withoutPlus);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatThreadCount(count: number): string {
  return `${count} ${pluralizeRu(count, "тред", "треда", "тредов")}`;
}

export function formatPostCount(count: number): string {
  return `${count} ${pluralizeRu(count, "ответ", "ответа", "ответов")}`;
}