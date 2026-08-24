import { Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../analytics/public/index.ts";
import type { CommentId, ModelId } from "../../_kernel/brandedIds.ts";
import { FeedRepository } from "../infrastructure/feed.repository.ts";
import type { FeedSocialOwnerPort } from "../public/index.ts";

const TITLE_MAX = 300;
const COMMENT_MAX = 4000;

function requiredText(value: string, max: number): string {
  if (value.trim() === "" || value.length > max) throw new UnprocessableEntityException();
  return value;
}

@Injectable()
export class FeedSocialOwnerService implements FeedSocialOwnerPort {
  constructor(
    @Inject(FeedRepository) private readonly repository: FeedRepository,
    @Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort,
  ) {}

  async recordSignal(input: Parameters<FeedSocialOwnerPort["recordSignal"]>[0]): Promise<void> {
    try {
      if (!(await this.analytics.hasActiveConsent({ anonId: null, userId: input.userId }))) return;
      await this.repository.recordSignal(input.postId, input.userId, input.eventType, input.props ?? {});
    } catch {
      // Behavioral analytics is deliberately fail-open for the product flow.
    }
  }

  async createLinkedPost(input: Parameters<FeedSocialOwnerPort["createLinkedPost"]>[0]) {
    const created = await this.repository.create({
      actorId: input.authorId,
      coAuthorAgentId: null,
      communityId: input.communityId ?? null,
      type: input.kind,
      title: requiredText(input.title, TITLE_MAX).trim(),
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

  createPolymorphicComment(input: Parameters<FeedSocialOwnerPort["createPolymorphicComment"]>[0]) {
    return this.repository.createOwnedComment({
      ...input,
      body: requiredText(input.body, COMMENT_MAX),
      parentId: input.parentId ?? null,
    });
  }

  listPolymorphicComments(subjectType: "model" | "make", subjectId: string) {
    return this.repository.polymorphicComments(subjectType, subjectId);
  }

  listPolymorphicCommentsWithDeleted(subjectType: "model" | "make", subjectId: string) {
    return this.repository.polymorphicCommentsWithDeleted(subjectType, subjectId);
  }

  findPolymorphicComment(subjectType: "model" | "make", subjectId: string, commentId: CommentId) {
    return this.repository.findPolymorphicComment(subjectType, subjectId, commentId);
  }

  polymorphicParentExists(subjectType: "model" | "make", subjectId: string, parentId: CommentId) {
    return this.repository.polymorphicParentExists(subjectType, subjectId, parentId);
  }

  findModelLinkPost(modelId: ModelId) {
    return this.repository.findModelLinkPost(modelId);
  }
  softDeleteCommentsForSubject(subjectType: "feed_post" | "model" | "make", subjectId: string) {
    return this.repository.softDeleteCommentsForSubject(subjectType, subjectId);
  }
  ensureModelLinkPost(...args: Parameters<FeedSocialOwnerPort["ensureModelLinkPost"]>) {
    return this.repository.ensureModelLinkPost(...args);
  }
  deleteModelLinkPost(modelId: ModelId) {
    return this.repository.deleteModelLinkPost(modelId);
  }
  insertCommentInTransaction(...args: Parameters<FeedSocialOwnerPort["insertCommentInTransaction"]>) {
    return this.repository.insertCommentInTransaction(...args);
  }
  markCommentDeletedInTransaction(...args: Parameters<FeedSocialOwnerPort["markCommentDeletedInTransaction"]>) {
    return this.repository.markCommentDeletedInTransaction(...args);
  }
}
