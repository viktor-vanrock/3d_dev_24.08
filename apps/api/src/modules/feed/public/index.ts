import type { Request } from "express";
import type { PoolClient } from "pg";
import type { CommentId, FeedPostId, ModelId, UserId } from "../../_kernel/brandedIds.ts";
import type { FeedActor, FeedAsset, FeedCommentRecord, FeedEventType, FeedGitverseRef, FeedPostRecord, FeedUpload, FeedVoteValue } from "../domain/feed.ts";

export const FEED_PORT = Symbol("FEED_PORT");
export const FEED_SOCIAL_OWNER_PORT = Symbol("FEED_SOCIAL_OWNER_PORT");
export const FEED_PROFILE_READ_PORT = Symbol("FEED_PROFILE_READ_PORT");
export const FEED_AGENT_AUTH_PORT = Symbol("FEED_AGENT_AUTH_PORT");
export const FEED_INGEST_AUTH_PORT = Symbol("FEED_INGEST_AUTH_PORT");
export const FEED_COMMUNITY_PORT = Symbol("FEED_COMMUNITY_PORT");
export const FEED_VOTES_PORT = Symbol("FEED_VOTES_PORT");
export const FEED_TAGS_READ_PORT = Symbol("FEED_TAGS_READ_PORT");
export const FEED_MODEL_READ_PORT = Symbol("FEED_MODEL_READ_PORT");
export const FEED_REFERENCES_PORT = Symbol("FEED_REFERENCES_PORT");
export const FEED_ANALYTICS_PORT = Symbol("FEED_ANALYTICS_PORT");
export const FEED_STORAGE_PORT = Symbol("FEED_STORAGE_PORT");
export const FEED_GITVERSE_PORT = Symbol("FEED_GITVERSE_PORT");
export const FEED_RATE_LIMIT_PORT = Symbol("FEED_RATE_LIMIT_PORT");
export const FEED_RANKING_READ_PORT = Symbol("FEED_RANKING_READ_PORT");

export interface FeedRankingReadPort {
  topScores(postIds: readonly FeedPostId[], window: string): Promise<ReadonlyMap<FeedPostId, number>>;
  coldCommunityFreshPostIds(postIds: readonly FeedPostId[], windowDays: number, postThreshold: number, freshHours: number): Promise<ReadonlySet<FeedPostId>>;
}

export interface FeedProfileStats {
  readonly postsCount: number;
  readonly postViewsCount: number;
  readonly postScore: number;
  readonly postCommentsCount: number;
}

export interface FeedProfileReadPort {
  statsByAuthor(userId: UserId): Promise<FeedProfileStats>;
}

export interface FeedAgentAuthPort {
  verifyAgentContentToken(token: string): Promise<FeedActor | null>;
}

export interface FeedIngestPrincipal {
  readonly userId: UserId;
  readonly scope: string;
}

export interface FeedIngestAuthPort {
  verifyIngestToken(token: string): Promise<FeedIngestPrincipal | null>;
}

export interface FeedCommunity {
  readonly id: string;
  readonly kind: string;
}

export interface FeedCommunityPort {
  findActive(communityId: string): Promise<FeedCommunity | null>;
  isMember(communityId: string, userId: UserId): Promise<boolean>;
  subscribedCommunityIds(userId: UserId): Promise<readonly string[]>;
  canIngest(communityId: string, userId: UserId): Promise<boolean>;
  gateDenial(communityId: string | null, userId: UserId): Promise<"ACCOUNT_TOO_NEW" | "REPUTATION_TOO_LOW" | null>;
}

export interface FeedVoteResult {
  readonly votes_up: number;
  readonly votes_down: number;
  readonly votes_up_weighted: number;
  readonly votes_down_weighted: number;
}

export interface FeedVotesPort {
  applyVote(input: {
    readonly subjectType: "feed_post" | "feed_comment";
    readonly subjectId: string;
    readonly userId: UserId;
    readonly value: FeedVoteValue;
  }): Promise<FeedVoteResult>;
  topScores(postIds: readonly FeedPostId[], window: string): Promise<ReadonlyMap<FeedPostId, number>>;
}

export interface FeedTagsReadPort {
  recommendationBoosts(userId: UserId, posts: readonly FeedPostRecord[]): Promise<ReadonlyMap<FeedPostId, number>>;
}

export interface FeedModelReadPort {
  visibleOwner(modelId: ModelId, callerId: UserId): Promise<UserId | null>;
}

export interface FeedReferencesPort {
  hydratePosts(posts: readonly FeedPostRecord[]): Promise<readonly FeedPostResponse[]>;
  hydrateComments(comments: readonly FeedCommentRecord[]): Promise<readonly FeedCommentResponse[]>;
}

export interface FeedAnalyticsPort {
  emit(input: { readonly eventName: string; readonly userId: UserId; readonly props?: Readonly<Record<string, unknown>>; readonly request: Request }): Promise<void>;
  hasActiveConsent(input: { readonly anonId: string | null; readonly userId: UserId }): Promise<boolean>;
}

export interface FeedStoragePort {
  uploadMedia(ownerId: UserId, upload: FeedUpload): Promise<{ readonly key: string; readonly url: string | null; readonly kind: "image" | "video" }>;
  uploadPostImage(postId: FeedPostId, upload: FeedUpload): Promise<{ readonly id: string; readonly key: string }>;
  asset(key: string): Promise<FeedAsset>;
  mediaKeyOwner(key: string): UserId | null;
  mediaKind(key: string): "image" | "video" | null;
}

export interface FeedGitversePort {
  parse(url: string): Promise<{ readonly normalized: string; readonly meta: FeedGitverseRef } | null>;
}

export interface FeedRateLimitPort {
  assertAllowed(action: string, userId: UserId, request: Request): Promise<void>;
}

export interface FeedPort {
  list(query: FeedListQuery, actor: FeedActor | null): Promise<FeedPageResponse>;
  create(body: FeedPostInput, actor: FeedActor, request: Request): Promise<FeedPostEnvelope>;
  ingest(body: FeedPostInput, principal: FeedIngestPrincipal, request: Request): Promise<{ readonly status: 200 | 201; readonly body: FeedIngestResponse }>;
  detail(postId: FeedPostId): Promise<FeedPostEnvelope>;
  asset(postId: FeedPostId, role: "media" | "poster"): Promise<FeedAsset>;
  patch(postId: FeedPostId, body: FeedPatchInput, actor: FeedActor): Promise<FeedPostEnvelope>;
  delete(postId: FeedPostId, actor: FeedActor): Promise<{ readonly ok: true }>;
  comments(postId: FeedPostId, query: FeedCommentsQuery): Promise<FeedCommentsResponse>;
  createComment(postId: FeedPostId, body: FeedCommentInput, actor: FeedActor, request: Request): Promise<{ readonly comment: FeedCommentResponse }>;
  deleteComment(commentId: CommentId, actor: FeedActor): Promise<{ readonly ok: true }>;
  votePost(postId: FeedPostId, value: FeedVoteValue | undefined, actor: FeedActor, request: Request): Promise<FeedVoteResponse>;
  voteComment(commentId: CommentId, value: FeedVoteValue | undefined, actor: FeedActor, request: Request): Promise<FeedVoteResponse>;
  save(postId: FeedPostId, actor: FeedActor, request: Request): Promise<{ readonly saved: boolean }>;
  unsave(postId: FeedPostId, actor: FeedActor): Promise<{ readonly saved: boolean }>;
  event(body: FeedEventInput, actor: FeedActor, request: Request): Promise<{ readonly ok: true }>;
  parseGitverse(url: string | undefined, actor: FeedActor, request: Request): Promise<FeedGitverseRef | null>;
  uploadMedia(upload: FeedUpload | undefined, actor: FeedActor, request: Request): Promise<FeedMediaUploadResponse>;
  uploadImage(postId: FeedPostId, upload: FeedUpload | undefined, actor: FeedActor): Promise<{ readonly url: string }>;
  image(postId: FeedPostId, fileId: string): Promise<FeedAsset>;
}

export interface FeedAuthorResponse {
  readonly id: UserId;
  readonly username: string;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
}
export interface FeedPostResponse extends FeedPostRecord {
  readonly author: FeedAuthorResponse | null;
}
export interface FeedCommentResponse extends FeedCommentRecord {
  readonly author: FeedAuthorResponse | null;
}
export interface FeedListQuery {
  readonly scope?: string;
  readonly sort?: string;
  readonly window?: string;
  readonly cursor?: string;
  readonly limit?: string | number;
  readonly author?: string;
  readonly community_id?: string;
}
export interface FeedPostInput {
  readonly type?: string;
  readonly title?: string;
  readonly body?: string;
  readonly model_id?: string;
  readonly media_s3_key?: string;
  readonly poster_s3_key?: string;
  readonly gitverse_url?: string;
  readonly community_id?: string;
  readonly source_url?: string;
  readonly source_fingerprint?: string;
  readonly ingest_provider?: string;
  readonly ingest_model?: string;
  readonly ingest_prompt_version?: string;
  readonly mode?: string;
}
export interface FeedPatchInput {
  readonly title?: string;
  readonly body?: string;
}
export interface FeedCommentsQuery {
  readonly sort?: string;
  readonly cursor?: string;
  readonly limit?: string;
}
export interface FeedCommentInput {
  readonly body?: string;
  readonly parent_id?: string | null;
}
export interface FeedEventProps {
  readonly post_id?: string;
  readonly subject_type?: string;
  readonly subject_id?: string;
  readonly community_id?: string | null;
  readonly value?: number;
  readonly duration_ms?: number;
  readonly position?: number;
  readonly target_url?: string;
}
export interface FeedEventInput {
  readonly event_name?: string;
  readonly props?: FeedEventProps;
}
export interface FeedPageResponse {
  readonly items: readonly FeedPostResponse[];
  readonly next_cursor: string | null;
  readonly scope: string;
  readonly recommendation_fallback: boolean;
}
export interface FeedPostEnvelope {
  readonly post: FeedPostResponse;
}
export interface FeedIngestResponse extends FeedPostEnvelope {
  readonly result: "skipped" | "published" | "draft_created";
  readonly skip?: { readonly code: "EXACT_DUPLICATE"; readonly community_id: string; readonly source_fingerprint: string; readonly existing_post_id: FeedPostId };
}
export interface FeedCommentsResponse {
  readonly comments: readonly FeedCommentResponse[];
  readonly next_cursor: string | null;
}
export interface FeedVoteResponse {
  readonly votes_up: number;
  readonly votes_down: number;
  readonly votes_up_weighted: number;
  readonly votes_down_weighted: number;
  readonly my_vote: FeedVoteValue;
}
export interface FeedMediaUploadResponse {
  readonly s3_key: string;
  readonly url: string | null;
  readonly kind: "image" | "video";
}

export interface FeedSocialOwnerPort {
  recordSignal(input: {
    readonly eventType: FeedEventType;
    readonly postId: FeedPostId;
    readonly userId: UserId;
    readonly props?: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  createLinkedPost(input: {
    readonly kind: "model_link" | "make";
    readonly authorId: UserId;
    readonly title: string;
    readonly body?: string | null;
    readonly modelId?: ModelId | null;
    readonly makeId?: string | null;
    readonly mediaKey?: string | null;
    readonly communityId?: string | null;
  }): Promise<FeedPostId>;
  createPolymorphicComment(input: {
    readonly subjectType: "feed_post" | "model" | "make";
    readonly subjectId: string;
    readonly userId: UserId;
    readonly body: string;
    readonly parentId?: CommentId | null;
  }): Promise<FeedCommentRecord>;
  listPolymorphicComments(subjectType: "model" | "make", subjectId: string): Promise<readonly FeedCommentRecord[]>;
  listPolymorphicCommentsWithDeleted(subjectType: "model" | "make", subjectId: string): Promise<readonly FeedModerationComment[]>;
  findPolymorphicComment(subjectType: "model" | "make", subjectId: string, commentId: CommentId): Promise<FeedModerationComment | null>;
  polymorphicParentExists(subjectType: "model" | "make", subjectId: string, parentId: CommentId): Promise<boolean>;
  findModelLinkPost(modelId: ModelId): Promise<FeedPostId | null>;
  softDeleteCommentsForSubject(subjectType: "feed_post" | "model" | "make", subjectId: string): Promise<void>;
  ensureModelLinkPost(modelId: ModelId, authorId: UserId, title: string): Promise<void>;
  deleteModelLinkPost(modelId: ModelId): Promise<void>;
  insertCommentInTransaction(
    client: PoolClient,
    input: {
      readonly subjectType: "model" | "make";
      readonly subjectId: string;
      readonly userId: UserId;
      readonly parentId: CommentId | null;
      readonly body: string;
    },
  ): Promise<{
    readonly id: string;
    readonly parent_id: string | null;
    readonly body: string;
    readonly created_at: Date;
    readonly deleted_at: Date | null;
    readonly deleted_by_owner: boolean | null;
    readonly author_id: string;
  }>;
  markCommentDeletedInTransaction(client: PoolClient, commentId: string, deletedByOwner: boolean): Promise<void>;
}

export interface FeedModerationComment {
  readonly id: CommentId;
  readonly userId: UserId;
  readonly parentId: CommentId | null;
  readonly body: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly deletedByOwner: boolean;
}

export type { FeedActor, FeedAsset, FeedCommentRecord, FeedGitverseRef, FeedPostRecord, FeedUpload, FeedVoteValue };
export { fetchGitverseRepoMeta } from "../infrastructure/gitverse-client.ts";
export { parseGitverseUrl } from "../infrastructure/gitverse-url.ts";
export { checkNewCommunityGate } from "../infrastructure/new-community-gate.ts";
export { voteTrustWeight } from "../domain/vote-trust.ts";
export { coldCommunityFreshHours, coldCommunityPostThreshold, coldCommunityWindowDays, interestWindowDays, recommendationBoost } from "../domain/personalization.ts";
