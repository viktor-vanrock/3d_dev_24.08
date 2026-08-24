import { Global, Inject, Injectable, Module, ServiceUnavailableException } from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createAgentContentApiKeyVerifier } from "../../modules/publicapi/public/legacy.ts";
import { createFeedIngestApiKeyVerifier } from "../../modules/publicapi/public/legacy.ts";
import { assertNestRateLimit } from "./rate-limit.ts";
import { feedMediaObjectKey, feedPostImageObjectKey, getModelObjectStream, isModelsStorageConfigured, modelPublicUrl, putModelObjectStream } from "../../storage/s3.ts";
import { AnalyticsModule } from "../../modules/analytics/analytics.module.ts";
import { ANALYTICS_PORT, type AnalyticsPort, type EventName } from "../../modules/analytics/public/index.ts";
import { ModelsModule } from "../../modules/models/models.module.ts";
import { MODEL_MAKES_PORT, MODEL_READ_PORT, type ModelMakesPort, type ModelReadPort } from "../../modules/models/public/index.ts";
import { ProfileModule } from "../../modules/profile/profile.module.ts";
import { PROFILE_AUTH_PORT, PROFILE_CONTENT_PORT, type ProfileAuthPort, type ProfileContentPort } from "../../modules/profile/public/index.ts";
import { pool } from "../../db/client.ts";
import { CommunityOwnerModule } from "../../modules/community/community-owner.module.ts";
import { COMMUNITY_FEED_READ_PORT, COMMUNITY_SOCIAL_OWNER_PORT, type CommunityFeedReadPort, type CommunitySocialOwnerPort } from "../../modules/community/public/index.ts";
import { FeedSocialOwnerModule } from "../../modules/feed/feed-social-owner.module.ts";
import {
  FEED_AGENT_AUTH_PORT,
  FEED_ANALYTICS_PORT,
  FEED_COMMUNITY_PORT,
  FEED_GITVERSE_PORT,
  FEED_INGEST_AUTH_PORT,
  FEED_MODEL_READ_PORT,
  FEED_RATE_LIMIT_PORT,
  FEED_RANKING_READ_PORT,
  FEED_REFERENCES_PORT,
  FEED_STORAGE_PORT,
  FEED_TAGS_READ_PORT,
  FEED_VOTES_PORT,
  checkNewCommunityGate,
  coldCommunityFreshHours,
  coldCommunityPostThreshold,
  coldCommunityWindowDays,
  fetchGitverseRepoMeta,
  interestWindowDays,
  parseGitverseUrl,
  recommendationBoost,
  voteTrustWeight,
  type FeedActor,
  type FeedAgentAuthPort,
  type FeedAnalyticsPort,
  type FeedAsset,
  type FeedCommunity,
  type FeedCommunityPort,
  type FeedGitversePort,
  type FeedIngestAuthPort,
  type FeedModelReadPort,
  type FeedPostRecord,
  type FeedCommentRecord,
  type FeedRateLimitPort,
  type FeedRankingReadPort,
  type FeedReferencesPort,
  type FeedStoragePort,
  type FeedTagsReadPort,
  type FeedVotesPort,
  type FeedUpload,
  type FeedVoteValue,
} from "../../modules/feed/public/index.ts";
import { UserId, type FeedPostId as FeedPostIdType, type ModelId, type UserId as UserIdType } from "../../modules/_kernel/brandedIds.ts";
import { MetricsService } from "../observability/metrics.service.ts";

@Injectable()
export class FeedAgentAuthAdapter implements FeedAgentAuthPort {
  constructor(
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}
  async verifyAgentContentToken(token: string): Promise<FeedActor | null> {
    const principal = await createAgentContentApiKeyVerifier(pool, this.profiles, this.metrics).verify(token);
    return principal === null ? null : { userId: UserId(principal.ownerId), coAuthorAgentId: principal.agentId };
  }
}

@Injectable()
export class FeedIngestAuthAdapter implements FeedIngestAuthPort {
  constructor(
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}
  async verifyIngestToken(token: string) {
    const principal = await createFeedIngestApiKeyVerifier(pool, this.profiles, this.metrics).verify(token);
    return principal === null ? null : { userId: UserId(principal.userId), scope: principal.scope };
  }
}

@Injectable()
export class FeedCommunityAdapter implements FeedCommunityPort {
  constructor(
    @Inject(COMMUNITY_FEED_READ_PORT) private readonly communities: CommunityFeedReadPort,
    @Inject(PROFILE_CONTENT_PORT) private readonly profiles: ProfileContentPort,
  ) {}
  findActive(communityId: string): Promise<FeedCommunity | null> {
    return this.communities.findActive(communityId);
  }
  isMember(communityId: string, userId: UserIdType): Promise<boolean> {
    return this.communities.isMember(communityId, userId);
  }
  subscribedCommunityIds(userId: UserIdType): Promise<readonly string[]> {
    return this.communities.subscribedCommunityIds(userId);
  }
  canIngest(communityId: string, userId: UserIdType): Promise<boolean> {
    return this.communities.canIngest(communityId, userId);
  }
  async gateDenial(communityId: string | null, userId: UserIdType) {
    if (communityId === null) return Promise.resolve(null);
    const [community, user] = await Promise.all([this.communities.gateState(communityId), this.profiles.trustState(userId)]);
    return checkNewCommunityGate(
      community === null ? null : { created_at: community.createdAt, kind: community.kind },
      user === null ? null : { created_at: user.createdAt, reputation_score: user.reputationScore },
    );
  }
}

@Injectable()
export class FeedVotesAdapter implements FeedVotesPort {
  constructor(
    @Inject(COMMUNITY_SOCIAL_OWNER_PORT) private readonly community: CommunitySocialOwnerPort,
    @Inject(PROFILE_CONTENT_PORT) private readonly profiles: ProfileContentPort,
    @Inject(FEED_RANKING_READ_PORT) private readonly ranking: FeedRankingReadPort,
  ) {}
  async applyVote(input: { readonly subjectType: "feed_post" | "feed_comment"; readonly subjectId: string; readonly userId: UserIdType; readonly value: FeedVoteValue }) {
    const state = await this.profiles.trustState(input.userId);
    const trust = state === null ? 1 : voteTrustWeight({ trustLevel: state.trustLevel, createdAt: state.createdAt });
    const counts = await this.community.applyWeightedVote(input.subjectType, input.subjectId, input.userId, input.value, trust);
    return { votes_up: counts.up, votes_down: counts.down, votes_up_weighted: counts.upWeighted, votes_down_weighted: counts.downWeighted };
  }
  async topScores(postIds: readonly FeedPostIdType[], window: string): Promise<ReadonlyMap<FeedPostIdType, number>> {
    return this.ranking.topScores(postIds, window);
  }
}

@Injectable()
export class FeedTagsAdapter implements FeedTagsReadPort {
  constructor(
    @Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort,
    @Inject(COMMUNITY_FEED_READ_PORT) private readonly communities: CommunityFeedReadPort,
    @Inject(MODEL_READ_PORT) private readonly models: ModelReadPort,
    @Inject(FEED_RANKING_READ_PORT) private readonly ranking: FeedRankingReadPort,
  ) {}
  async recommendationBoosts(userId: UserIdType, posts: readonly FeedPostRecord[]): Promise<ReadonlyMap<FeedPostIdType, number>> {
    if (posts.length === 0) return new Map();
    const communityIds = [...new Set(posts.flatMap((post) => (post.community_id === null ? [] : [post.community_id])))];
    const postModelIds = [...new Set(posts.flatMap((post) => (post.model_id === null ? [] : [post.model_id])))];
    const [subscribedIds, interests, coldPostIds] = await Promise.all([
      this.communities.subscribedCommunityIds(userId),
      this.analytics.recentFeedInterests(userId, interestWindowDays()),
      this.ranking.coldCommunityFreshPostIds(
        posts.map((post) => post.id),
        coldCommunityWindowDays(),
        coldCommunityPostThreshold(),
        coldCommunityFreshHours(),
      ),
    ]);
    const interestTagIds = await this.models.tagIdsForModels(interests.modelIds);
    const [taggedCommunityIds, taggedModelIds] = await Promise.all([
      this.communities.communityIdsWithAnyTags(communityIds, interestTagIds),
      this.models.modelIdsWithAnyTags(postModelIds, interestTagIds),
    ]);
    const subscribed = new Set(subscribedIds);
    const eventCommunities = new Set(interests.communityIds);
    return new Map(
      posts.map((post) => [
        post.id,
        recommendationBoost({
          subscribed: post.community_id !== null && subscribed.has(post.community_id),
          interestMatch:
            (post.community_id !== null && (eventCommunities.has(post.community_id) || taggedCommunityIds.has(post.community_id))) ||
            (post.model_id !== null && taggedModelIds.has(post.model_id)),
          coldCommunityFresh: coldPostIds.has(post.id),
        }),
      ]),
    );
  }
}

@Injectable()
export class FeedModelAdapter implements FeedModelReadPort {
  constructor(@Inject(MODEL_MAKES_PORT) private readonly models: ModelMakesPort) {}
  async visibleOwner(modelId: ModelId, _callerId: UserIdType): Promise<UserIdType | null> {
    return (await this.models.find(modelId))?.ownerId ?? null;
  }
}

@Injectable()
export class FeedReferencesAdapter implements FeedReferencesPort {
  constructor(@Inject(PROFILE_CONTENT_PORT) private readonly profiles: ProfileContentPort) {}
  async hydratePosts(posts: readonly FeedPostRecord[]) {
    const authors = await this.profiles.findAuthors(posts.map((post) => post.author_id));
    return posts.map((post) => {
      const author = authors.get(post.author_id);
      return {
        ...post,
        author: author === undefined ? null : { id: author.id, username: author.username, display_name: author.displayName, avatar_url: author.avatarUrl },
      };
    });
  }
  async hydrateComments(comments: readonly FeedCommentRecord[]) {
    const authors = await this.profiles.findAuthors(comments.map((comment) => comment.user_id));
    return comments.map((comment) => {
      const author = authors.get(comment.user_id);
      return { ...comment, author: author === undefined ? null : { id: author.id, username: author.username, display_name: author.displayName, avatar_url: author.avatarUrl } };
    });
  }
}

@Injectable()
export class FeedAnalyticsAdapter implements FeedAnalyticsPort {
  constructor(@Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort) {}
  async emit(input: Parameters<FeedAnalyticsPort["emit"]>[0]): Promise<void> {
    await this.analytics.emitEvent({ anonId: null, userId: input.userId, eventName: input.eventName as EventName, props: input.props });
  }
  hasActiveConsent(input: Parameters<FeedAnalyticsPort["hasActiveConsent"]>[0]): Promise<boolean> {
    return this.analytics.hasActiveConsent(input);
  }
}

function mediaType(buffer: Buffer): { ext: string; contentType: string; kind: "image" | "video" } {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", contentType: "image/png", kind: "image" };
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { ext: "jpg", contentType: "image/jpeg", kind: "image" };
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") return { ext: "mp4", contentType: "video/mp4", kind: "video" };
  return { ext: "bin", contentType: "application/octet-stream", kind: "image" };
}

@Injectable()
export class FeedStorageAdapter implements FeedStoragePort {
  async uploadMedia(ownerId: UserIdType, upload: FeedUpload) {
    if (!isModelsStorageConfigured()) throw new ServiceUnavailableException();
    const type = mediaType(upload.buffer);
    const key = feedMediaObjectKey(ownerId, randomUUID(), type.ext);
    await putModelObjectStream(key, Readable.from(upload.buffer), type.contentType);
    return { key, url: modelPublicUrl(key), kind: type.kind };
  }
  async uploadPostImage(postId: FeedPostIdType, upload: FeedUpload) {
    if (!isModelsStorageConfigured()) throw new ServiceUnavailableException();
    const type = mediaType(upload.buffer);
    const id = randomUUID();
    const key = feedPostImageObjectKey(postId, id, type.ext);
    await putModelObjectStream(key, Readable.from(upload.buffer), type.contentType);
    return { id, key };
  }
  async asset(key: string): Promise<FeedAsset> {
    const publicUrl = modelPublicUrl(key);
    const object = publicUrl === null ? await getModelObjectStream(key) : null;
    if (publicUrl === null && object === null) throw new ServiceUnavailableException();
    const ext = key.split(".").pop() ?? "";
    const contentType = ext === "png" ? "image/png" : ext === "jpg" ? "image/jpeg" : ext === "mp4" ? "video/mp4" : "application/octet-stream";
    return { key, publicUrl, object, contentType };
  }
  mediaKeyOwner(key: string): UserIdType | null {
    const match = /^public\/feed\/([0-9a-f-]{36})\//i.exec(key);
    return match?.[1] === undefined ? null : UserId(match[1]);
  }
  mediaKind(key: string): "image" | "video" | null {
    const ext = key.split(".").pop()?.toLowerCase();
    if (ext === "mp4") return "video";
    if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return "image";
    return null;
  }
}

@Injectable()
export class FeedGitverseAdapter implements FeedGitversePort {
  async parse(url: string) {
    const meta = await fetchGitverseRepoMeta(url);
    if (meta === null) return null;
    return { normalized: parseGitverseUrl(url).normalized, meta };
  }
}

@Injectable()
export class FeedRateLimitAdapter implements FeedRateLimitPort {
  assertAllowed(action: string, userId: UserIdType, request: Request): Promise<void> {
    const scope = action === "feed_comment" ? "feed_comment_create" : action;
    return assertNestRateLimit(request, scope as Parameters<typeof assertNestRateLimit>[1], userId);
  }
}

@Global()
@Module({
  imports: [AnalyticsModule, CommunityOwnerModule, FeedSocialOwnerModule, ModelsModule, ProfileModule],
  providers: [
    FeedAgentAuthAdapter,
    FeedIngestAuthAdapter,
    FeedCommunityAdapter,
    FeedVotesAdapter,
    FeedTagsAdapter,
    FeedModelAdapter,
    FeedReferencesAdapter,
    FeedAnalyticsAdapter,
    FeedStorageAdapter,
    FeedGitverseAdapter,
    FeedRateLimitAdapter,
    { provide: FEED_AGENT_AUTH_PORT, useExisting: FeedAgentAuthAdapter },
    { provide: FEED_INGEST_AUTH_PORT, useExisting: FeedIngestAuthAdapter },
    { provide: FEED_COMMUNITY_PORT, useExisting: FeedCommunityAdapter },
    { provide: FEED_VOTES_PORT, useExisting: FeedVotesAdapter },
    { provide: FEED_TAGS_READ_PORT, useExisting: FeedTagsAdapter },
    { provide: FEED_MODEL_READ_PORT, useExisting: FeedModelAdapter },
    { provide: FEED_REFERENCES_PORT, useExisting: FeedReferencesAdapter },
    { provide: FEED_ANALYTICS_PORT, useExisting: FeedAnalyticsAdapter },
    { provide: FEED_STORAGE_PORT, useExisting: FeedStorageAdapter },
    { provide: FEED_GITVERSE_PORT, useExisting: FeedGitverseAdapter },
    { provide: FEED_RATE_LIMIT_PORT, useExisting: FeedRateLimitAdapter },
  ],
  exports: [
    FEED_AGENT_AUTH_PORT,
    FEED_INGEST_AUTH_PORT,
    FEED_COMMUNITY_PORT,
    FEED_VOTES_PORT,
    FEED_TAGS_READ_PORT,
    FEED_MODEL_READ_PORT,
    FEED_REFERENCES_PORT,
    FEED_ANALYTICS_PORT,
    FEED_STORAGE_PORT,
    FEED_GITVERSE_PORT,
    FEED_RATE_LIMIT_PORT,
  ],
})
export class FeedIntegrationModule {}
