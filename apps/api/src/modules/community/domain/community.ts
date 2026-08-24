export const COMMUNITY_ROLES = ["member", "moderator", "owner"] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];
export const THREAD_TYPES = ["discussion", "question"] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];
export const POST_KINDS = ["answer", "reply", "comment"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const SUBSCRIBE_SOURCES = ["feed_left", "feed_right", "printer_connection", "community_page"] as const;
export type SubscribeSource = (typeof SUBSCRIBE_SOURCES)[number];
export const COMMUNITY_NAME_MAX_LENGTH = 120;
export const COMMUNITY_DESCRIPTION_MAX_LENGTH = 4000;
export const THREAD_TITLE_MAX_LENGTH = 200;
export const THREAD_CONTENT_MAX_LENGTH = 20_000;
export const POST_CONTENT_MAX_LENGTH = 20_000;
export const MAX_POST_ATTACHMENTS = 10;
export const MAX_PHOTO_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_MODEL_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export function roundMemberCount(count: number): string {
  if (count < 10) return String(count);
  const magnitude = 10 ** Math.floor(Math.log10(count));
  const rounded = Math.floor(count / magnitude) * magnitude;
  return `${rounded >= 1000 ? `${rounded / 1000}k` : rounded}+`;
}

const CYRILLIC: Record<string, string> = {
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
export function slugify(name: string): string {
  return [...name.toLowerCase()]
    .map((c) => CYRILLIC[c] ?? c)
    .join("")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}
export const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
