import { Global, Inject, Injectable, Module, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { uploadMakePhoto } from "../../modules/makes/public/index.ts";
import { avatarRefsByUserId } from "../../modules/profile/public/legacy.ts";
import { getModelObjectPresignedUrl, getModelObjectStream } from "../../storage/s3.ts";
import { assertNestRateLimit } from "./rate-limit.ts";
import { FeedModule } from "../../modules/feed/feed.module.ts";
import { FEED_SOCIAL_OWNER_PORT, type FeedSocialOwnerPort } from "../../modules/feed/public/index.ts";
import { CommunityModule } from "../../modules/community/community.module.ts";
import { COMMUNITY_SOCIAL_OWNER_PORT, type CommunitySocialOwnerPort } from "../../modules/community/public/index.ts";
import { ModelsModule } from "../../modules/models/models.module.ts";
import { MODEL_MAKES_PORT, type ModelMakesPort } from "../../modules/models/public/index.ts";
import { ProfileModule } from "../../modules/profile/profile.module.ts";
import { PROFILE_CONTENT_PORT, type ProfileContentPort } from "../../modules/profile/public/index.ts";
import {
  MAKE_COMMENTS_PORT,
  MAKE_FEED_SIGNAL_PORT,
  MAKE_PROFILE_PORT,
  MAKE_RATE_LIMIT_PORT,
  MAKE_STORAGE_PORT,
  MAKE_TAGS_PORT,
  MAKE_VOTES_PORT,
  type MakeAuthor,
  type MakeCommentsPort,
  type MakeFeedSignalPort,
  type MakeProfilePort,
  type MakeRateLimitPort,
  type MakeStoragePort,
  type MakeTagsPort,
  type MakeVotesPort,
} from "../../modules/makes/public/index.ts";
import { CommentId, FeedPostId, type MakeId as MakeIdType, type ModelId as ModelIdType, type UserId as UserIdType } from "../../modules/_kernel/brandedIds.ts";
import type { MakeAsset, MakeCommentRecord, MakeUpload } from "../../modules/makes/public/index.ts";

@Injectable()
export class MakeVotesAdapter implements MakeVotesPort {
  constructor(@Inject(COMMUNITY_SOCIAL_OWNER_PORT) private readonly community: CommunitySocialOwnerPort) {}
  async toggleLike(makeId: MakeIdType, userId: UserIdType) {
    return this.community.togglePositiveVote("make", makeId, userId);
  }
}

@Injectable()
export class MakeCommentsAdapter implements MakeCommentsPort {
  constructor(@Inject(FEED_SOCIAL_OWNER_PORT) private readonly feed: FeedSocialOwnerPort) {}
  async list(makeId: MakeIdType): Promise<readonly MakeCommentRecord[]> {
    return this.feed.listPolymorphicComments("make", makeId);
  }
  async parentExists(makeId: MakeIdType, parentId: string): Promise<boolean> {
    return this.feed.polymorphicParentExists("make", makeId, CommentId(parentId));
  }
  async create(input: { readonly makeId: MakeIdType; readonly userId: UserIdType; readonly body: string; readonly parentId: string | null }): Promise<MakeCommentRecord> {
    return this.feed.createPolymorphicComment({
      subjectType: "make",
      subjectId: input.makeId,
      userId: input.userId,
      body: input.body,
      parentId: input.parentId === null ? null : CommentId(input.parentId),
    });
  }
}

@Injectable()
export class MakeTagsAdapter implements MakeTagsPort {
  constructor(
    @Inject(COMMUNITY_SOCIAL_OWNER_PORT) private readonly community: CommunitySocialOwnerPort,
    @Inject(MODEL_MAKES_PORT) private readonly models: ModelMakesPort,
  ) {}
  async modelIdsForTag(name: string): Promise<readonly ModelIdType[]> {
    const tagId = await this.community.findTagIdByName(name);
    return tagId === null ? [] : this.models.modelIdsForTagId(tagId);
  }
}

@Injectable()
export class MakeProfileAdapter implements MakeProfilePort {
  constructor(
    @Inject(PROFILE_CONTENT_PORT) private readonly profiles: ProfileContentPort,
  ) {}
  async authors(userIds: readonly UserIdType[]): Promise<ReadonlyMap<UserIdType, MakeAuthor>> {
    const profiles = await this.profiles.findAuthors(userIds);
    const avatars = await avatarRefsByUserId([...userIds]);
    const result = new Map<UserIdType, MakeAuthor>();
    for (const [id, profile] of profiles) {
      result.set(id, {
        id,
        username: profile.username,
        display_name: profile.displayName,
        avatar_url: profile.avatarUrl,
        avatar_config: avatars.get(id)?.avatar_config ?? null,
        avatar_snapshots: avatars.get(id)?.avatar_snapshots ?? null,
      });
    }
    return result;
  }
}

@Injectable()
export class MakeStorageAdapter implements MakeStoragePort {
  async uploadPhoto(makeId: MakeIdType, upload: MakeUpload) {
    const result = await uploadMakePhoto(makeId, upload.buffer, upload.filename, upload.contentType);
    return result.ok ? { ok: true as const, photo: result.photo } : { ok: false as const, error: result.error };
  }
  async asset(key: string): Promise<MakeAsset> {
    const publicUrl = await getModelObjectPresignedUrl(key);
    const object = publicUrl === null ? await getModelObjectStream(key) : null;
    if (publicUrl === null && object === null) throw new NotFoundException();
    const ext = key.split(".").pop()?.toLowerCase();
    const contentType = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "application/octet-stream";
    return { publicUrl, object, contentType };
  }
}

@Injectable()
export class MakeRateLimitAdapter implements MakeRateLimitPort {
  assertAllowed(action: "make_create" | "make_image" | "make_report", userId: UserIdType, request: Request): Promise<void> {
    return assertNestRateLimit(request, action, userId);
  }
}

@Injectable()
export class MakeFeedSignalAdapter implements MakeFeedSignalPort {
  constructor(@Inject(FEED_SOCIAL_OWNER_PORT) private readonly feed: FeedSocialOwnerPort) {}
  async findModelLinkPost(modelId: ModelIdType): Promise<string | null> {
    return this.feed.findModelLinkPost(modelId);
  }
  async recordRemix(input: Parameters<MakeFeedSignalPort["recordRemix"]>[0]): Promise<void> {
    await this.feed.recordSignal({
      eventType: "remix",
      postId: FeedPostId(input.postId),
      userId: input.userId,
      props: { make_id: input.makeId, model_id: input.modelId },
    });
  }
}

@Global()
@Module({
  imports: [CommunityModule, FeedModule, ModelsModule, ProfileModule],
  providers: [
    MakeVotesAdapter,
    MakeCommentsAdapter,
    MakeTagsAdapter,
    MakeProfileAdapter,
    MakeStorageAdapter,
    MakeRateLimitAdapter,
    MakeFeedSignalAdapter,
    { provide: MAKE_VOTES_PORT, useExisting: MakeVotesAdapter },
    { provide: MAKE_COMMENTS_PORT, useExisting: MakeCommentsAdapter },
    { provide: MAKE_TAGS_PORT, useExisting: MakeTagsAdapter },
    { provide: MAKE_PROFILE_PORT, useExisting: MakeProfileAdapter },
    { provide: MAKE_STORAGE_PORT, useExisting: MakeStorageAdapter },
    { provide: MAKE_RATE_LIMIT_PORT, useExisting: MakeRateLimitAdapter },
    { provide: MAKE_FEED_SIGNAL_PORT, useExisting: MakeFeedSignalAdapter },
  ],
  exports: [MAKE_VOTES_PORT, MAKE_COMMENTS_PORT, MAKE_TAGS_PORT, MAKE_PROFILE_PORT, MAKE_STORAGE_PORT, MAKE_RATE_LIMIT_PORT, MAKE_FEED_SIGNAL_PORT],
})
export class MakesIntegrationModule {}
