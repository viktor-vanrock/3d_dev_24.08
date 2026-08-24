import { isUuid } from "../../../db/uuid.ts";

// Общий контракт Фазы 2 (MF-35/MF-415, docs/epics/community.foundation.md): сообщества → треды
// (discussion|question) → посты (answer|reply|comment). Схема — Фаза 1 (MF-414), эта карточка
// строит CRUD+вложенную сортировку поверх неё.

export const COMMUNITY_KINDS = ["machine", "vendor", "craft", "custom"] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export const COMMUNITY_NAME_MAX_LENGTH = 120;
export const COMMUNITY_DESCRIPTION_MAX_LENGTH = 4000;

export const THREAD_TYPES = ["discussion", "question"] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];

export const THREAD_TITLE_MAX_LENGTH = 200;
export const THREAD_CONTENT_MAX_LENGTH = 20_000;
export const THREAD_MAX_TAGS = 5;

export const COMMUNITY_MAX_TAGS = 10;

export const POST_KINDS = ["answer", "reply", "comment"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const POST_CONTENT_MAX_LENGTH = 20_000;

// Вложения поста (MF-744, часть MF-35 Ф2 п.2): фото и .3mf, переиспользуют пайплайн MF-8
// (models/formats.ts для .3mf, models/descriptionimage.ts для фото) — своей детекции формата
// не заводим. 'model_3mf' — сознательно уже 'source' из models/formats.ts: пост показывает
// готовую модель сообществу, не пайплайн-исходник (ничего конвертировать не нужно).
export const POST_ATTACHMENT_KINDS = ["photo", "model_3mf"] as const;
export type PostAttachmentKind = (typeof POST_ATTACHMENT_KINDS)[number];
export const MAX_POST_ATTACHMENTS = 10;

export const COMMUNITY_ROLES = ["member", "moderator", "owner"] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

// Источник подписки/отписки (MF-823, событие community_subscribe) — откуда юзер нажал кнопку,
// нужно продукту для воронки MF-808 (какая точка входа конвертит лучше). Необязателен в
// теле запроса — клиенты, которые ещё не проставляют source, не ломаются (fallback ниже,
// membership.ts).
export const SUBSCRIBE_SOURCES = ["feed_left", "feed_right", "printer_connection", "community_page"] as const;
export type SubscribeSource = (typeof SUBSCRIBE_SOURCES)[number];

export function isSubscribeSource(value: unknown): value is SubscribeSource {
  return typeof value === "string" && (SUBSCRIBE_SOURCES as readonly string[]).includes(value);
}

export function isCommunityKind(value: unknown): value is CommunityKind {
  return typeof value === "string" && (COMMUNITY_KINDS as readonly string[]).includes(value);
}

export function isThreadType(value: unknown): value is ThreadType {
  return typeof value === "string" && (THREAD_TYPES as readonly string[]).includes(value);
}

export function isPostKind(value: unknown): value is PostKind {
  return typeof value === "string" && (POST_KINDS as readonly string[]).includes(value);
}

export function isCommunityRole(value: unknown): value is CommunityRole {
  return typeof value === "string" && (COMMUNITY_ROLES as readonly string[]).includes(value);
}

// slug — та же форма, что уже проверяет БД (`slug = lower(slug) and length(slug) > 0`), плюс
// ограничение на алфавит, чтобы не заводить URL-мусор (пробелы/юникод) руками через custom-кейс.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_RE.test(value);
}

// RU-портал: имена сообществ обычно кириллические ("Барахолка", "Bambu Lab фанаты") — без
// транслитерации slugify схлопывал бы их в пустую строку/общий "club" (не-ascii просто вырезался
// бы), что убивает читаемость URL и плодит коллизии. Побуквенная транслитерация — тот же подход,
// что и везде в рунете (ГОСТ-подобная, не научная).
const CYRILLIC_TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function transliterate(name: string): string {
  return [...name.toLowerCase()].map((char) => CYRILLIC_TRANSLIT[char] ?? char).join("");
}

export function slugify(name: string): string {
  return transliterate(name)
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function parseTagNames(raw: unknown): string[] | undefined {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  if (raw.length > THREAD_MAX_TAGS) return undefined;
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") return undefined;
    const cleaned = entry.trim().toLowerCase().slice(0, 40);
    if (cleaned) seen.add(cleaned);
  }
  return [...seen];
}

// tag_ids саба (MF-767 п.1) — ссылки на уже существующие global tags (MF-11), не имена: сам
// tag создаётся/переиспользуется в другом месте (модели/треды), саб только вешает taxономию.
export function parseTagIds(raw: unknown): string[] | undefined {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  if (raw.length > COMMUNITY_MAX_TAGS) return undefined;
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !isUuid(entry)) return undefined;
    seen.add(entry);
  }
  return [...seen];
}

// Счётчик подписчиков саба — округляем на публичных ручках (антипиратский принцип, не палим
// точный размер аудитории конкурентам/скреперам, см. родительскую карточку MF-421 п.5).
// Экспортируется как строка ("100+", "1k+") для округлённого случая — точное число (`exact`)
// остаётся только для owner/moderator саба (вызывающий код решает, что передать).
export function roundMemberCount(count: number): string {
  if (count < 10) return String(count);
  const magnitude = 10 ** Math.floor(Math.log10(count));
  const rounded = Math.floor(count / magnitude) * magnitude;
  const short = rounded >= 1000 ? `${rounded / 1000}k` : String(rounded);
  return `${short}+`;
}
