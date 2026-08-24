import type { IdeaId, UserId } from "../../_kernel/brandedIds.ts";

export const IDEA_TITLE_MAX_LENGTH = 120;
export const IDEA_BODY_MAX_LENGTH = 20_000;
export const IDEA_COMMENT_MAX_LENGTH = 5_000;
export const IDEA_DAILY_LIMIT = 3;
export const IDEA_ENRICH_DAILY_LIMIT = 10;
export const IDEA_ENRICH_FREE_TEXT_MAX_LENGTH = 4_000;

export const IDEA_CATEGORIES = ["catalog", "projects", "forum", "account", "other"] as const;
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];

export const IDEA_TYPES = ["idea", "problem"] as const;
export type IdeaType = (typeof IDEA_TYPES)[number];

export const IDEA_STATUSES = ["proposed", "under_review", "planned", "in_progress", "done", "declined", "duplicate", "archived", "hidden", "removed"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const IDEA_STATUSES_REQUIRING_REASON = new Set<IdeaStatus>(["declined", "duplicate"]);
export const IDEA_MODERATION_STATUSES = new Set<IdeaStatus>(["hidden", "removed"]);

export const IDEA_ORIGIN_SOURCES = ["model", "search", "catalog", "error", "forum"] as const;
export type IdeaOriginSource = (typeof IDEA_ORIGIN_SOURCES)[number];

export interface IdeaOrigin {
  readonly source: IdeaOriginSource;
  readonly ref_id?: string;
  readonly ref_url?: string;
  readonly query?: string;
}

export interface Idea {
  readonly id: IdeaId;
  readonly author_id: UserId;
  readonly title: string;
  readonly body: string;
  readonly category: IdeaCategory;
  readonly type: IdeaType;
  readonly status: IdeaStatus;
  readonly canonical_id: IdeaId | null;
  vote_count: number;
  readonly decline_reason: string | null;
  readonly origin: IdeaOrigin | null;
  readonly ai_assisted: boolean;
  readonly created_at: Date;
  readonly last_activity_at: Date;
}

export interface IdeaComment {
  readonly id: string;
  readonly idea_id: IdeaId;
  readonly user_id: UserId;
  readonly body: string;
  readonly created_at: Date;
}

export function computeTrendScore(voteCount: number, createdAt: Date): number {
  const ageHours = (Date.now() - createdAt.getTime()) / 3_600_000;
  return voteCount / Math.pow(ageHours + 2, 1.5);
}

export function parseLimit(raw: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined, length: number): readonly (string | number)[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(parsed) && parsed.length === length ? (parsed as (string | number)[]) : null;
  } catch {
    return null;
  }
}
