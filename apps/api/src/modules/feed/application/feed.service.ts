import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Request } from "express";
import { CommentId, FeedPostId, ModelId, UserId, type FeedPostId as FeedPostIdType, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import {
  FEED_POST_TYPES,
  FEED_SCOPES,
  FEED_SORTS,
  FEED_WINDOWS,
  type FeedActor,
  type FeedAsset,
  type FeedCommentRecord,
  type FeedEventType,
  type FeedPostType,
  type FeedUpload,
  type FeedVoteValue,
} from "../domain/feed.ts";
import { FeedRepository } from "../infrastructure/feed.repository.ts";
import {
  FEED_ANALYTICS_PORT,
  FEED_COMMUNITY_PORT,
  FEED_GITVERSE_PORT,
  FEED_MODEL_READ_PORT,
  FEED_RATE_LIMIT_PORT,
  FEED_REFERENCES_PORT,
  FEED_STORAGE_PORT,
  FEED_TAGS_READ_PORT,
  FEED_VOTES_PORT,
  type FeedAnalyticsPort,
  type FeedCommunityPort,
  type FeedGitversePort,
  type FeedModelReadPort,
  type FeedPort,
  type FeedRateLimitPort,
  type FeedReferencesPort,
  type FeedSocialOwnerPort,
  type FeedStoragePort,
  type FeedTagsReadPort,
  type FeedVotesPort,
  type FeedIngestPrincipal,
  type FeedCommentInput,
  type FeedCommentResponse,
  type FeedCommentsQuery,
  type FeedCommentsResponse,
  type FeedEventInput,
  type FeedIngestResponse,
  type FeedGitverseRef,
  type FeedListQuery,
  type FeedMediaUploadResponse,
  type FeedPageResponse,
  type FeedPatchInput,
  type FeedPostEnvelope,
  type FeedPostInput,
  type FeedPostResponse,
  type FeedVoteResponse,
} from "../public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TITLE_MAX = 300;
const COMMENT_MAX = 4000;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const CLIENT_EVENTS = new Set(["feed_scope_change", "feed_post_draft_start", "printer_catalog_view", "printer_facet_apply", "printer_card_view", "printer_card_click_through"]);
const POST_EVENTS: Readonly<Record<string, FeedEventType>> = {
  feed_post_open: "view",
  feed_post_dwell: "dwell",
  feed_post_share: "share",
  feed_post_download: "download",
};

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function numberLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function requiredUuid(value: string): string {
  if (!UUID_RE.test(value)) throw new NotFoundException();
  return value;
}

function voteValue(value: unknown): FeedVoteValue {
  if (value !== -1 && value !== 0 && value !== 1) throw new UnprocessableEntityException();
  return value;
}

function requiredString(value: unknown, max?: number): string {
  if (typeof value !== "string" || value.trim() === "" || (max !== undefined && value.length > max)) {
    throw new UnprocessableEntityException();
  }
  return value;
}

@Injectable()
export class FeedService implements FeedPort, FeedSocialOwnerPort {
  constructor(
    @Inject(FeedRepository) private readonly repository: FeedRepository,
    @Inject(FEED_COMMUNITY_PORT) private readonly communities: FeedCommunityPort,
    @Inject(FEED_VOTES_PORT) private readonly votes: FeedVotesPort,
    @Inject(FEED_TAGS_READ_PORT) private readonly tags: FeedTagsReadPort,
    @Inject(FEED_MODEL_READ_PORT) private readonly models: FeedModelReadPort,
    @Inject(FEED_REFERENCES_PORT) private readonly references: FeedReferencesPort,
    @Inject(FEED_ANALYTICS_PORT) private readonly analytics: FeedAnalyticsPort,
    @Inject(FEED_STORAGE_PORT) private readonly storage: FeedStoragePort,
    @Inject(FEED_GITVERSE_PORT) private readonly gitverse: FeedGitversePort,
    @Inject(FEED_RATE_LIMIT_PORT) private readonly rateLimits: FeedRateLimitPort,
  ) {}

  private firstPost(items: readonly FeedPostResponse[]): FeedPostResponse {
    const item = items[0];
    if (item === undefined) throw new Error("Feed post hydration returned no item");
    return item;
  }

  private firstComment(items: readonly FeedCommentResponse[]): FeedCommentResponse {
    const item = items[0];
    if (item === undefined) throw new Error("Feed comment hydration returned no item");
    return item;
  }

  async list(query: FeedListQuery, actor: FeedActor | null): Promise<FeedPageResponse> {
    if (query.scope !== undefined && !oneOf(query.scope, FEED_SCOPES)) throw new UnprocessableEntityException();
    if (query.sort !== undefined && !oneOf(query.sort, FEED_SORTS)) throw new UnprocessableEntityException();
    if (query.window !== undefined && !oneOf(query.window, FEED_WINDOWS)) throw new UnprocessableEntityException();
    const scope = oneOf(query.scope, FEED_SCOPES) ? query.scope : "all";
    if (scope === "subscribed" && actor === null) throw new UnauthorizedException();
    const sort = scope === "recommended" ? "hot" : oneOf(query.sort, FEED_SORTS) ? query.sort : "hot";
    const authorId = query.author === undefined ? null : UserId(requiredUuid(typeof query.author === "string" ? query.author : ""));
    const explicitCommunityId = query.community_id === undefined ? null : requiredUuid(typeof query.community_id === "string" ? query.community_id : "");
    const communityIds =
      explicitCommunityId !== null ? [explicitCommunityId] : scope === "subscribed" && actor !== null ? await this.communities.subscribedCommunityIds(actor.userId) : null;
    let rows = [...(await this.repository.list({ limit: numberLimit(query.limit) + 1, authorId, communityIds, sort }))];
    const window = oneOf(query.window, FEED_WINDOWS) ? query.window : "all";
    if (sort === "top" && window !== "all") {
      const scores = await this.votes.topScores(
        rows.map((row) => row.id),
        window,
      );
      rows.sort((left, right) => (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0));
    }
    if (scope === "recommended" && actor !== null) {
      const boosts = await this.tags.recommendationBoosts(actor.userId, rows);
      rows.sort((left, right) => (boosts.get(right.id) ?? 0) - (boosts.get(left.id) ?? 0));
    }
    const limit = numberLimit(query.limit);
    const hasMore = rows.length > limit;
    rows = rows.slice(0, limit);
    return {
      items: await this.references.hydratePosts(rows),
      next_cursor: hasMore ? Buffer.from(rows.at(-1)?.id ?? "").toString("base64url") : null,
      scope,
      recommendation_fallback: scope === "recommended" && actor === null,
    };
  }

  async create(body: FeedPostInput, actor: FeedActor, request: Request): Promise<FeedPostEnvelope> {
    await this.rateLimits.assertAllowed("feed_post_create", actor.userId, request);
    if (!oneOf(body.type, FEED_POST_TYPES)) throw new UnprocessableEntityException();
    const type = body.type;
    const title = requiredString(body.title, TITLE_MAX).trim();
    const communityId = await this.validateCommunity(body.community_id, actor);
    let postBody: string | null = typeof body.body === "string" && body.body.trim() !== "" ? body.body : null;
    let modelId: string | null = null;
    let mediaKey: string | null = null;
    let posterKey: string | null = null;
    let gitverseUrl: string | null = null;
    let gitverseMeta: unknown = null;

    if (type === "text") postBody = requiredString(body.body);
    if (type === "model_link") {
      modelId = requiredString(body.model_id);
      if (!UUID_RE.test(modelId) || (await this.models.visibleOwner(ModelId(modelId), actor.userId)) === null) {
        throw new UnprocessableEntityException();
      }
    }
    if (type === "media") {
      mediaKey = requiredString(body.media_s3_key);
      if (this.storage.mediaKeyOwner(mediaKey) !== actor.userId) throw new ForbiddenException();
      const kind = this.storage.mediaKind(mediaKey);
      if (kind === null) throw new UnprocessableEntityException();
      if (kind === "video") posterKey = requiredString(body.poster_s3_key);
      else posterKey = typeof body.poster_s3_key === "string" && body.poster_s3_key !== "" ? body.poster_s3_key : null;
      if (posterKey !== null && (this.storage.mediaKeyOwner(posterKey) !== actor.userId || this.storage.mediaKind(posterKey) !== "image")) {
        throw new ForbiddenException();
      }
    }
    if (type === "gitverse") {
      const parsed = await this.gitverse.parse(requiredString(body.gitverse_url));
      if (parsed === null) throw new UnprocessableEntityException();
      gitverseUrl = parsed.normalized;
      gitverseMeta = parsed.meta;
    }
    const created = await this.repository.create({
      actorId: actor.userId,
      coAuthorAgentId: actor.coAuthorAgentId,
      communityId,
      type,
      title,
      body: postBody,
      modelId,
      mediaKey,
      posterKey,
      gitverseUrl,
      gitverseMeta,
    });
    await this.analytics.emit({ eventName: "feed_post", userId: actor.userId, props: { post_id: created.id, type, community_id: communityId }, request });
    return { post: this.firstPost(await this.references.hydratePosts([created])) };
  }

  async ingest(body: FeedPostInput, principal: FeedIngestPrincipal, request: Request): Promise<{ readonly status: 200 | 201; readonly body: FeedIngestResponse }> {
    if (principal.scope !== "feed_ingest") throw new ForbiddenException();
    const communityId = requiredString(body.community_id);
    if (!UUID_RE.test(communityId) || !(await this.communities.canIngest(communityId, principal.userId))) throw new ForbiddenException();
    const type: FeedPostType = oneOf(body.type, FEED_POST_TYPES) ? body.type : "text";
    const sourceUrl = requiredString(body.source_url);
    const sourceFingerprint = requiredString(body.source_fingerprint);
    const provider = requiredString(body.ingest_provider);
    const model = requiredString(body.ingest_model);
    const promptVersion = requiredString(body.ingest_prompt_version);
    const visible = body.mode === "publish";
    const result = await this.repository.ingest({
      actorId: principal.userId,
      communityId,
      type,
      title: requiredString(body.title, TITLE_MAX).trim(),
      body: typeof body.body === "string" ? body.body : null,
      mediaKey: typeof body.media_s3_key === "string" ? body.media_s3_key : null,
      sourceUrl,
      sourceFingerprint,
      provider,
      model,
      promptVersion,
      publish: visible,
    });
    if (result.publishedNow) await this.analytics.emit({ eventName: "feed_post", userId: principal.userId, props: { post_id: result.row.id, actor: "api_key" }, request });
    const hydrated = this.firstPost(await this.references.hydratePosts([result.row]));
    if (result.replay && !result.publishedNow) {
      return {
        status: 200,
        body: {
          post: hydrated,
          result: "skipped",
          skip: { code: "EXACT_DUPLICATE", community_id: communityId, source_fingerprint: sourceFingerprint, existing_post_id: result.row.id },
        },
      };
    }
    return { status: result.replay ? 200 : 201, body: { post: hydrated, result: result.publishedNow ? "published" : "draft_created" } };
  }

  async detail(postId: FeedPostIdType): Promise<FeedPostEnvelope> {
    const row = await this.visible(postId);
    return { post: this.firstPost(await this.references.hydratePosts([row])) };
  }

  async asset(postId: FeedPostIdType, role: "media" | "poster"): Promise<FeedAsset> {
    const row = await this.visible(postId);
    const key = role === "media" ? row.media_s3_key : row.poster_s3_key;
    if (key === null) throw new NotFoundException();
    return this.storage.asset(key);
  }

  async patch(postId: FeedPostIdType, body: FeedPatchInput, actor: FeedActor): Promise<FeedPostEnvelope> {
    const existing = await this.owned(postId, actor.userId);
    const title = body.title === undefined ? undefined : requiredString(body.title, TITLE_MAX).trim();
    const postBody = body.body === undefined ? undefined : requiredString(body.body);
    if (title === undefined && postBody === undefined) throw new UnprocessableEntityException();
    if (title !== undefined && Date.now() - existing.created_at.getTime() > 15 * 60 * 1000) throw new ConflictException();
    const updated = await this.repository.patch(postId, title, postBody);
    return { post: this.firstPost(await this.references.hydratePosts([updated])) };
  }

  async delete(postId: FeedPostIdType, actor: FeedActor): Promise<{ readonly ok: true }> {
    await this.owned(postId, actor.userId);
    await this.repository.softDelete(postId);
    return { ok: true };
  }

  async comments(postId: FeedPostIdType, query: FeedCommentsQuery): Promise<FeedCommentsResponse> {
    await this.visible(postId);
    const rows = await this.repository.comments(postId, numberLimit(query.limit));
    return { comments: await this.references.hydrateComments(rows), next_cursor: null };
  }

  async createComment(postId: FeedPostIdType, body: FeedCommentInput, actor: FeedActor, request: Request): Promise<{ readonly comment: FeedCommentResponse }> {
    await this.rateLimits.assertAllowed("feed_comment", actor.userId, request);
    const target = await this.visible(postId);
    const denial = await this.communities.gateDenial(target.community_id, actor.userId);
    if (denial !== null) throw new ForbiddenException();
    const parentId = body.parent_id === undefined || body.parent_id === null ? null : CommentId(requiredUuid(typeof body.parent_id === "string" ? body.parent_id : ""));
    if (parentId !== null && (await this.repository.findComment(parentId))?.subject_id !== postId) throw new UnprocessableEntityException();
    const created = await this.repository.createComment(postId, actor.userId, requiredString(body.body, COMMENT_MAX), parentId);
    await this.analytics.emit({ eventName: "feed_comment", userId: actor.userId, props: { post_id: postId, parent_id: parentId, community_id: target.community_id }, request });
    return { comment: this.firstComment(await this.references.hydrateComments([created])) };
  }

  async deleteComment(commentId: CommentId, actor: FeedActor): Promise<{ readonly ok: true }> {
    const existing = await this.repository.findComment(commentId);
    if (existing === null) throw new NotFoundException();
    if (existing.user_id !== actor.userId) throw new ForbiddenException();
    await this.repository.deleteComment(commentId, existing.subject_id);
    return { ok: true };
  }

  votePost(postId: FeedPostIdType, value: FeedVoteValue | undefined, actor: FeedActor, request: Request): Promise<FeedVoteResponse> {
    return this.vote("feed_post", postId, value, actor, request);
  }

  voteComment(commentId: CommentId, value: FeedVoteValue | undefined, actor: FeedActor, request: Request): Promise<FeedVoteResponse> {
    return this.vote("feed_comment", commentId, value, actor, request);
  }

  async save(postId: FeedPostIdType, actor: FeedActor, _request: Request): Promise<{ readonly saved: boolean }> {
    await this.visible(postId);
    if (await this.repository.save(actor.userId, postId)) {
      await this.recordSignal({ eventType: "favorite", postId, userId: actor.userId });
    }
    return { saved: true };
  }

  async unsave(postId: FeedPostIdType, actor: FeedActor): Promise<{ readonly saved: boolean }> {
    await this.repository.unsave(actor.userId, postId);
    return { saved: false };
  }

  async event(body: FeedEventInput, actor: FeedActor, request: Request): Promise<{ readonly ok: true }> {
    const eventName = typeof body.event_name === "string" ? body.event_name : "";
    const props = body.props === undefined ? {} : { ...body.props };
    const signal = POST_EVENTS[eventName];
    if (signal !== undefined) {
      const postId = FeedPostId(requiredUuid(typeof props.post_id === "string" ? props.post_id : ""));
      await this.recordSignal({ eventType: signal, postId, userId: actor.userId, props });
      return { ok: true };
    }
    if (!CLIENT_EVENTS.has(eventName)) throw new BadRequestException();
    await this.analytics.emit({ eventName, userId: actor.userId, props, request });
    return { ok: true };
  }

  async parseGitverse(url: string | undefined, actor: FeedActor, request: Request): Promise<FeedGitverseRef | null> {
    await this.rateLimits.assertAllowed("feed_gitverse_parse", actor.userId, request);
    if (url === undefined || url === "") throw new UnprocessableEntityException();
    return (await this.gitverse.parse(url))?.meta ?? null;
  }

  async uploadMedia(upload: FeedUpload | undefined, actor: FeedActor, request: Request): Promise<FeedMediaUploadResponse> {
    if (upload === undefined) throw new BadRequestException();
    await this.rateLimits.assertAllowed("feed_media_upload", actor.userId, request);
    try {
      const result = await this.storage.uploadMedia(actor.userId, upload);
      return { s3_key: result.key, url: result.url, kind: result.kind };
    } catch (error) {
      this.mapStorageError(error);
    }
  }

  async uploadImage(postId: FeedPostIdType, upload: FeedUpload | undefined, actor: FeedActor): Promise<{ readonly url: string }> {
    if (upload === undefined) throw new BadRequestException();
    const existing = await this.owned(postId, actor.userId);
    if (existing.status !== "visible") throw new ConflictException();
    try {
      const stored = await this.storage.uploadPostImage(postId, upload);
      await this.repository.addImage(postId, stored.id, stored.key);
      return { url: `/feed/posts/${postId}/images/${stored.id}` };
    } catch (error) {
      this.mapStorageError(error);
    }
  }

  async image(postId: FeedPostIdType, fileId: string): Promise<FeedAsset> {
    await this.visible(postId);
    requiredUuid(fileId);
    const key = await this.repository.imageKey(postId, fileId);
    if (key === null) throw new NotFoundException();
    return this.storage.asset(key);
  }

  async createLinkedPost(input: Parameters<FeedSocialOwnerPort["createLinkedPost"]>[0]): Promise<FeedPostIdType> {
    const created = await this.repository.create({
      actorId: input.authorId,
      coAuthorAgentId: null,
      communityId: input.communityId ?? null,
      type: input.kind,
      title: requiredString(input.title, TITLE_MAX).trim(),
      body: input.body ?? null,
      modelId: input.modelId ?? null,
      makeId: input.makeId ?? null,
      mediaKey: input.mediaKey ?? null,
      posterKey: null,
      gitverseUrl: null,
      gitverseMeta: null,
    });
    return created.id;
  }

  async recordSignal(input: Parameters<FeedSocialOwnerPort["recordSignal"]>[0]): Promise<void> {
    try {
      if (!(await this.analytics.hasActiveConsent({ anonId: null, userId: input.userId }))) return;
      await this.repository.recordSignal(input.postId, input.userId, input.eventType, input.props ?? {});
    } catch {
      // Behavioral analytics is deliberately fail-open for the product flow.
    }
  }

  createPolymorphicComment(input: Parameters<FeedSocialOwnerPort["createPolymorphicComment"]>[0]): Promise<FeedCommentRecord> {
    return this.repository.createOwnedComment({
      ...input,
      body: requiredString(input.body, COMMENT_MAX),
      parentId: input.parentId ?? null,
    });
  }

  listPolymorphicComments(subjectType: "model" | "make", subjectId: string): Promise<readonly FeedCommentRecord[]> {
    return this.repository.polymorphicComments(subjectType, subjectId);
  }

  listPolymorphicCommentsWithDeleted(subjectType: "model" | "make", subjectId: string) {
    return this.repository.polymorphicCommentsWithDeleted(subjectType, subjectId);
  }

  findPolymorphicComment(subjectType: "model" | "make", subjectId: string, commentId: CommentId) {
    return this.repository.findPolymorphicComment(subjectType, subjectId, commentId);
  }

  polymorphicParentExists(subjectType: "model" | "make", subjectId: string, parentId: CommentId): Promise<boolean> {
    return this.repository.polymorphicParentExists(subjectType, subjectId, parentId);
  }

  findModelLinkPost(modelId: ModelId): Promise<FeedPostIdType | null> {
    return this.repository.findModelLinkPost(modelId);
  }

  softDeleteCommentsForSubject(subjectType: "feed_post" | "model" | "make", subjectId: string): Promise<void> {
    return this.repository.softDeleteCommentsForSubject(subjectType, subjectId);
  }

  ensureModelLinkPost(modelId: ModelId, authorId: UserIdType, title: string): Promise<void> {
    return this.repository.ensureModelLinkPost(modelId, authorId, title);
  }

  deleteModelLinkPost(modelId: ModelId): Promise<void> {
    return this.repository.deleteModelLinkPost(modelId);
  }

  insertCommentInTransaction(
    client: Parameters<FeedSocialOwnerPort["insertCommentInTransaction"]>[0],
    input: Parameters<FeedSocialOwnerPort["insertCommentInTransaction"]>[1],
  ): ReturnType<FeedSocialOwnerPort["insertCommentInTransaction"]> {
    return this.repository.insertCommentInTransaction(client, input);
  }

  markCommentDeletedInTransaction(client: Parameters<FeedSocialOwnerPort["markCommentDeletedInTransaction"]>[0], commentId: string, deletedByOwner: boolean): Promise<void> {
    return this.repository.markCommentDeletedInTransaction(client, commentId, deletedByOwner);
  }

  private async validateCommunity(raw: unknown, actor: FeedActor): Promise<string | null> {
    if (raw === undefined || raw === null) return null;
    const id = requiredUuid(typeof raw === "string" ? raw : "");
    const community = await this.communities.findActive(id);
    if (community === null) throw new UnprocessableEntityException();
    const officialAgentPost = actor.coAuthorAgentId !== null && (community.kind === "vendor" || community.kind === "machine");
    if (!officialAgentPost && !(await this.communities.isMember(id, actor.userId))) throw new ForbiddenException();
    if ((await this.communities.gateDenial(id, actor.userId)) !== null) throw new ForbiddenException();
    return id;
  }

  private async visible(postId: FeedPostIdType) {
    const row = await this.repository.findVisible(postId);
    if (row === null) throw new NotFoundException();
    return row;
  }

  private async owned(postId: FeedPostIdType, userId: UserIdType) {
    const row = await this.repository.find(postId);
    if (row === null) throw new NotFoundException();
    if (row.author_id !== userId) throw new ForbiddenException();
    return row;
  }

  private async vote(
    subjectType: "feed_post" | "feed_comment",
    subjectId: string,
    rawValue: FeedVoteValue | undefined,
    actor: FeedActor,
    request: Request,
  ): Promise<FeedVoteResponse> {
    await this.rateLimits.assertAllowed("feed_vote", actor.userId, request);
    const value = voteValue(rawValue);
    let authorId: UserIdType;
    let post = null;
    if (subjectType === "feed_post") {
      post = await this.repository.find(FeedPostId(subjectId));
      if (post === null) throw new NotFoundException();
      authorId = post.author_id;
    } else {
      const comment = await this.repository.findComment(CommentId(subjectId));
      if (comment === null) throw new NotFoundException();
      authorId = comment.user_id;
      post = await this.repository.find(comment.subject_id);
      if (post === null) throw new NotFoundException();
    }
    if (authorId === actor.userId) throw new ForbiddenException();
    if ((await this.communities.gateDenial(post.community_id, actor.userId)) !== null) throw new ForbiddenException();
    const counts = await this.votes.applyVote({ subjectType, subjectId, userId: actor.userId, value });
    await this.repository.updateVoteCounts(subjectType, subjectId, counts.votes_up, counts.votes_down, counts.votes_up_weighted, counts.votes_down_weighted);
    if (value !== 0) {
      await this.analytics.emit({
        eventName: "feed_vote",
        userId: actor.userId,
        props: { subject_type: subjectType, subject_id: subjectId, community_id: post.community_id, value },
        request,
      });
    }
    return { ...counts, my_vote: value };
  }

  private mapStorageError(error: unknown): never {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "FILE_TOO_LARGE") throw new PayloadTooLargeException();
    if (code === "UNSUPPORTED_MEDIA_FORMAT") throw new UnsupportedMediaTypeException();
    if (code === "STORAGE_NOT_CONFIGURED") throw new ServiceUnavailableException();
    throw error;
  }
}
