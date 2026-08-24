// Клиент ленты /feed (MF-816, docs/design/feed.post.editor.md, docs/epics/feed.page.md §10).
// Контракт списка/голосов/комментариев уже задеплоен Back (apps/api/src/feed/*, MF-764/765/766) —
// эти функции читают его как есть. Часть ручек, которых спека ждёт от Fullstack (единичный GET
// поста, PATCH/DELETE, аплоад картинки в тело, список "моих сабов", джойны author/community/model
// в ответах), ещё не задеплоена на момент реализации этой карточки — заявка зафиксирована в
// MF-825 (карточка Fullstack, создана вслед за этой). Вызовы уже собраны по намеченному контракту
// (тот же приём, что forkModel в market/models.ts, GAP-API §13 п.28) — заработают без правок Front,
// как только эндпоинт появится на проде; до тех пор соответствующая функция возвращает `null`/`[]`,
// и экран показывает уже спроектированное состояние ошибки (не падает).

import type { AvatarConfig, AvatarSnapshots } from "@shared/avatar";
import { apiFetch } from "@shared/api";
import type { components } from "../../../api/generated/openapi";

// sessionStorage-флаг «пришёл из ленты» — читает post.tsx (скролл-подсказка/приглушение
// заголовка при возврате), пишут feedscreen.tsx и postcard.tsx перед переходом на пост.
// Живёт здесь (не в post.tsx), чтобы postcard.tsx мог использовать его без цикличного импорта.
export const FEED_ORIGIN_KEY = "portal.feed.cameFromList";

export type FeedPostType = "model_link" | "media" | "text" | "gitverse" | "make" | "printer_announcement";

export interface FeedAuthorRef {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  // Персонаж-маскот автора (MF-1030 отдаёт в джойнах ленты/комментариев) — опционально: старые
  // тестовые фикстуры и превью редактора (editor.tsx) вправе собрать author без этих полей.
  avatar_config?: AvatarConfig | null;
  avatar_snapshots?: AvatarSnapshots | null;
}

export interface FeedCommunityRef {
  id: string;
  slug: string;
  name: string;
  kind?: "machine" | "vendor" | "craft" | "custom";
  subject_type?: "machine" | "vendor" | null;
  subject_id?: string | null;
  is_official?: boolean;
}

export interface FeedModelRef {
  id: string;
  title: string;
  thumb_url: string | null;
  votes_up: number;
  downloads_count: number;
}

// Двойная подпись (MF-2028/MF-2030, docs/epics/agent.accounts.md) — НЕ путать с source_type
// ниже ("Опубликовано агентом" — анонимный feed_ingest сервис-аккаунт, отдельный контур).
// co_author — именной агент КОНКРЕТНОГО пользователя, чей agent_content-ключ создал пост от
// его лица; оба имени показываются вместе, не заменяют друг друга.
export interface FeedAgentRef {
  id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  runtime_label: string | null;
}

// Метаданные GitVerse-репо (feed.md §2.2, feed.post.editor.md §2.6, MF-1051) — отдаёт парсер
// вложения (Data), `null` = превью не подтянулось (приватный/битый репо/rate-limit), карточка
// деградирует до голой ссылки (post.gitverse_url), не блокирует публикацию.
export interface FeedGitverseRef {
  owner: string;
  name: string;
  avatar_url: string | null;
  description: string | null;
  stars: number;
  language: string | null;
}

// Единый provenance-контракт feed_ingest (MF-2052). API возвращает его вложенным объектом,
// потому что это атрибуция конкретной версии публикации, а не набор независимых полей карточки.
// Старые flat-поля ниже пока сохраняем: они нужны локальным фикстурам и постам прежнего контура.
export interface FeedPostProvenance {
  source_url: string;
  source_fingerprint: string;
  provider: string;
  model: string;
  prompt_version: string;
}

// Поля author/community/model — джойны, которых текущий GET /feed/GET /feed/posts/:id ещё не
// отдаёт (MF-825 п.1) — `undefined`, пока Back их не добавил, карточка/страница деградируют на
// "автор"/без названия саба, а не падают. media_url — то же самое для media_s3_key (MF-825 п.4).
export interface FeedPost {
  id: string;
  type: FeedPostType;
  title: string;
  body: string | null;
  body_html?: string | null;
  community_id: string | null;
  community?: FeedCommunityRef | null;
  author_id: string;
  author?: FeedAuthorRef | null;
  co_author_agent_id?: string | null;
  co_author?: FeedAgentRef | null;
  model_id: string | null;
  model?: FeedModelRef | null;
  machine_id?: string | null;
  make_id?: string | null;
  media_s3_key: string | null;
  media_url?: string | null;
  media_kind?: "image" | "video" | null;
  poster_url?: string | null;
  gitverse_url?: string | null;
  gitverse?: FeedGitverseRef | null;
  provenance?: FeedPostProvenance | null;
  source_type?: "human" | "agent" | "import";
  source_url?: string | null;
  source_provider?: string | null;
  source_model?: string | null;
  reviewed_by_user_id?: string | null;
  votes_up: number;
  votes_down: number;
  my_vote?: -1 | 0 | 1;
  score_approx?: boolean;
  comments_count: number;
  is_edited?: boolean;
  edited_at?: string | null;
  status?: "draft" | "visible" | "hidden" | "deleted";
  created_at: string;
}

export interface FeedComment {
  id: string;
  user_id: string;
  author?: FeedAuthorRef | null;
  parent_id: string | null;
  body: string;
  votes_up: number;
  votes_down: number;
  my_vote?: -1 | 0 | 1;
  created_at: string;
}

export type FeedScope = "all" | "subscribed" | "recommended";
export type FeedSort = "hot" | "new" | "top" | "best" | "controversial";

export interface FeedPage {
  items: FeedPost[];
  next_cursor: string | null;
}

export async function listFeed(
  params: { scope?: FeedScope; sort?: FeedSort; cursor?: string; limit?: number } = {},
): Promise<FeedPage | null> {
  const query = new URLSearchParams();
  if (params.scope) query.set("scope", params.scope);
  if (params.sort) query.set("sort", params.sort);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  const response = await apiFetch(`/feed${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as FeedPage;
}

export async function listCommunityFeed(
  communityId: string,
  limitOrParams: number | { limit?: number; cursor?: string } = 3,
): Promise<FeedPage | null> {
  const params = typeof limitOrParams === "number" ? { limit: limitOrParams } : limitOrParams;
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const response = await apiFetch(`/communities/${encodeURIComponent(communityId)}/feed?${query.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as FeedPage;
}

// Публичная лента автора для поста и профиля (MF-868/MF-1947): тот же GET /feed,
// отфильтрованный по UUID автора. Сортировка new нужна профилю как хронология работы.
export async function listAuthorFeed(authorId: string, limit = 3, cursor?: string): Promise<FeedPage | null> {
  const query = new URLSearchParams({ author: authorId, limit: String(limit), sort: "new" });
  if (cursor) query.set("cursor", cursor);
  const response = await apiFetch(`/feed?${query.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as FeedPage;
}

// Единичный пост (feed.post.editor.md §1) — GET /feed/posts/:id ещё не задеплоен (MF-825 п.1),
// сейчас всегда 404. Экран показывает состояние "не удалось загрузить" (§1.8) до появления ручки.
export async function getFeedPost(id: string): Promise<FeedPost | null> {
  const response = await apiFetch(`/feed/posts/${encodeURIComponent(id)}`, { credentials: "include" });
  if (!response.ok) return null;
  const body = (await response.json()) as { post: FeedPost };
  return body.post;
}

export interface CreateFeedPostInput {
  type: FeedPostType;
  title: string;
  body?: string;
  model_id?: string;
  media_s3_key?: string;
  gitverse_url?: string;
  community_id?: string | null;
  status?: "draft" | "visible";
}

export async function createFeedPost(input: CreateFeedPostInput): Promise<FeedPost | null> {
  const response = await apiFetch(`/feed/posts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { post: FeedPost };
  return body.post;
}

// Правка тела/заголовка поста (feed.post.editor.md §2.10) — PATCH /feed/posts/:id ещё не
// задеплоен (MF-825 п.2).
export async function updateFeedPost(id: string, patch: { title?: string; body?: string }): Promise<boolean> {
  const response = await apiFetch(`/feed/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return response.ok;
}

// Удаление поста (§2.10) — DELETE /feed/posts/:id ещё не задеплоен (MF-825 п.3).
export async function deleteFeedPost(id: string): Promise<boolean> {
  const response = await apiFetch(`/feed/posts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return response.ok;
}

export interface VoteResult {
  votes_up: number;
  votes_down: number;
  my_vote: -1 | 0 | 1;
}

export async function voteFeedPost(id: string, value: -1 | 0 | 1): Promise<VoteResult | null> {
  const response = await apiFetch(`/feed/posts/${encodeURIComponent(id)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) return null;
  return (await response.json()) as components["schemas"]["FeedVoteResponseDto"];
}

export async function voteFeedComment(id: string, value: -1 | 0 | 1): Promise<VoteResult | null> {
  const response = await apiFetch(`/feed/comments/${encodeURIComponent(id)}/vote`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) return null;
  return (await response.json()) as components["schemas"]["FeedVoteResponseDto"];
}

export interface FeedCommentPage {
  items: FeedComment[];
  next_cursor: string | null;
}

export async function listFeedComments(
  postId: string,
  params: { sort?: "best" | "new" | "top"; cursor?: string; limit?: number } = {},
): Promise<FeedCommentPage | null> {
  const query = new URLSearchParams();
  if (params.sort) query.set("sort", params.sort);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  const response = await apiFetch(`/feed/posts/${encodeURIComponent(postId)}/comments${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as FeedCommentPage;
}

export async function createFeedComment(postId: string, body: string, parentId?: string): Promise<FeedComment | null> {
  const response = await apiFetch(`/feed/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, parent_id: parentId }),
  });
  if (!response.ok) return null;
  return (await response.json()) as FeedComment;
}

// Удаление своей реплики (feed.post.editor.md §1.6) — DELETE /feed/comments/:id ещё не
// задеплоен (MF-825 п.3, тот же пакет, что удаление поста — общая полиморфная comments).
export async function deleteFeedComment(id: string): Promise<boolean> {
  const response = await apiFetch(`/feed/comments/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return response.ok;
}

export interface FeedCommunityOption {
  id: string;
  slug: string;
  name: string;
  kind?: "machine" | "vendor" | "craft" | "custom";
  subject_type?: "machine" | "vendor" | null;
  subject_id?: string | null;
  is_official?: boolean;
  // Домен бренда (vendors.website, резолвится JOIN'ом на бэке — communities.ts#communityFields) —
  // строит favicon-иконку саба вместо цветной буквы (MF-2039). null у custom-сабов.
  website?: string | null;
}

// «Куда публикую» (§2.3) — сабы, где автор состоит, по последней активности. GET /communities
// сегодня не фильтрует по членству (apps/api/src/community/communities.ts — только kind/q/cursor),
// заявка на `member=me` — MF-825 п.6. До появления фильтра список молча пуст (форма показывает
// только «В мой профиль» — так и задумано спекой на случай "нигде не состоит").
export async function listMyCommunities(): Promise<FeedCommunityOption[]> {
  const response = await apiFetch(`/communities?member=me&limit=50`, { credentials: "include" });
  if (!response.ok) return [];
  const body = (await response.json()) as { items: FeedCommunityOption[] };
  return body.items;
}

// Медиа-вложение поста (feed.post.editor.md §2.6, «анонс принтера» — media_s3_key в create.ts).
// В отличие от картинки внутри статьи (модель уже отдаёт готовый s3-ключ), файл вложения ещё
// нигде не загружается на сервер — генерик-ручки загрузки под фид нет (community/attachments.ts
// грузит только в уже существующий тред форума, тот же паттерн модели требует существующего id).
// POST /feed/media ещё не задеплоен (MF-825 п.8) — до появления форма честно показывает тост
// "Не удалось опубликовать", черновик не теряется (localStorage).
export async function uploadFeedMedia(file: File): Promise<{ s3_key: string; url: string } | null> {
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch(`/feed/media`, { method: "POST", credentials: "include", body: form });
  if (!response.ok) return null;
  return (await response.json()) as { s3_key: string; url: string };
}

// Парсер метаданных GitVerse-вложения (feed.post.editor.md §2.6, MF-1051) — «на blur/Enter
// клиент дёргает парсер метаданных (Data)». Ручка ещё не задеплоена на момент реализации Front —
// заявка отдельным комментарием на MF-1055 команде Data/Back. До появления эндпоинта функция
// честно возвращает `null`, форма показывает уже спроектированную деградацию (§2.6: ссылка
// сохраняется, превью не блокирует публикацию) — не падает и не имитирует данные.
export async function parseGitverseAttachment(url: string): Promise<FeedGitverseRef | null> {
  const response = await apiFetch(`/feed/gitverse/parse?url=${encodeURIComponent(url)}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as FeedGitverseRef;
}

// Картинка внутри статьи поста (feed.post.editor.md §2.5/§2.9) — тот же контракт ответа/ошибок,
// что uploadDescriptionImage (market/models.ts, MarkdownEditor#handleImagePicked ждёт "throw",
// не null), но целится в пост, не в модель. Эндпоинт ещё не задеплоен (MF-825 п.7) — вызывается
// только на /feed/p/:id у уже опубликованного поста (editor.tsx держит кнопку disabled до этого).
export async function uploadFeedPostImage(postId: string, file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await apiFetch(`/feed/posts/${encodeURIComponent(postId)}/images`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } catch {
    throw new Error("network");
  }
  if (!response.ok) throw new Error("unknown");
  return (await response.json()) as { url: string };
}
