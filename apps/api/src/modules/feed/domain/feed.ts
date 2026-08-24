import type { Readable } from "node:stream";
import type { CommentId, FeedPostId, ModelId, UserId } from "../../_kernel/brandedIds.ts";

export const FEED_SORTS = ["hot", "new", "top", "best", "controversial"] as const;
export const FEED_WINDOWS = ["hour", "day", "week", "month", "year", "all"] as const;
export const FEED_SCOPES = ["all", "subscribed", "recommended"] as const;
export const FEED_POST_TYPES = ["model_link", "media", "text", "gitverse"] as const;
export const FEED_EVENT_TYPES = ["view", "read_complete", "model_click", "download", "favorite", "time_on_post", "vote", "comment", "remix", "dwell", "share"] as const;

export type FeedSort = (typeof FEED_SORTS)[number];
export type FeedWindow = (typeof FEED_WINDOWS)[number];
export type FeedScope = (typeof FEED_SCOPES)[number];
export type FeedPostType = (typeof FEED_POST_TYPES)[number];
export type FeedEventType = (typeof FEED_EVENT_TYPES)[number];
export type FeedVoteValue = -1 | 0 | 1;

export interface FeedGitverseRef {
  readonly owner: string;
  readonly name: string;
  readonly avatar_url: string | null;
  readonly description: string | null;
  readonly stars: number;
  readonly language: string | null;
}

export interface FeedActor {
  readonly userId: UserId;
  readonly coAuthorAgentId: string | null;
}

export interface FeedPostRecord {
  readonly id: FeedPostId;
  readonly author_id: UserId;
  readonly co_author_agent_id: string | null;
  readonly community_id: string | null;
  readonly type: string;
  readonly title: string;
  readonly body: string | null;
  readonly model_id: ModelId | null;
  readonly media_s3_key: string | null;
  readonly make_id: string | null;
  readonly poster_s3_key: string | null;
  readonly gitverse_url: string | null;
  readonly gitverse_meta: FeedGitverseRef | null;
  readonly votes_up: number;
  readonly votes_down: number;
  readonly comments_count: number;
  readonly status: string;
  readonly created_at: Date;
  readonly is_edited: boolean;
  readonly edited_at: Date | null;
  readonly source_url: string | null;
  readonly source_fingerprint: string | null;
  readonly ingest_provider: string | null;
  readonly ingest_model: string | null;
  readonly ingest_prompt_version: string | null;
}

export interface FeedCommentRecord {
  readonly id: CommentId;
  readonly user_id: UserId;
  readonly parent_id: CommentId | null;
  readonly body: string;
  readonly votes_up: number;
  readonly votes_down: number;
  readonly created_at: Date;
}

export interface FeedObject {
  readonly body: Readable;
  readonly etag?: string;
  readonly contentLength?: number;
}

export interface FeedAsset {
  readonly key: string;
  readonly publicUrl: string | null;
  readonly object: FeedObject | null;
  readonly contentType: string;
}

export interface FeedUpload {
  readonly buffer: Buffer;
}
