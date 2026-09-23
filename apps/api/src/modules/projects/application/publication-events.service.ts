import { Inject, Injectable, Logger } from "@nestjs/common";
import { ModelId, UserId } from "../../_kernel/brandedIds.ts";
import { FEED_SOCIAL_OWNER_PORT, type FeedSocialOwnerPort } from "../../feed/public/index.ts";
import { MODEL_INDEX_PORT, type ModelIndexPort } from "../../models/public/index.ts";

export interface PublishedProjectSnapshot {
  readonly projectId: string;
  readonly revisionId: string;
  readonly actorId: string;
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly primaryModelId: string;
  readonly models: ReadonlyArray<{
    readonly modelId: string;
    readonly revisionId: string;
  }>;
}

@Injectable()
export class PublicationEventsService {
  private readonly logger = new Logger(PublicationEventsService.name);

  constructor(
    @Inject(MODEL_INDEX_PORT) private readonly index: ModelIndexPort,
    @Inject(FEED_SOCIAL_OWNER_PORT) private readonly feed: FeedSocialOwnerPort,
  ) {}

  /** Runs after the publication transaction committed; failures are deliberately isolated. */
  async afterPublish(snapshot: PublishedProjectSnapshot): Promise<void> {
    await Promise.allSettled([this.enqueueSearchIndex(snapshot), this.createFeedPost(snapshot)]);
  }

  /** Runs after unpublishing committed; failures are deliberately isolated. */
  async afterUnpublish(params: { readonly projectId: string; readonly actorId: string; readonly version: number }): Promise<void> {
    await Promise.allSettled([this.removeFromSearchIndex(params.projectId)]);
  }

  private async enqueueSearchIndex(snapshot: PublishedProjectSnapshot): Promise<void> {
    for (const model of snapshot.models) {
      try {
        await this.index.enqueue(ModelId(model.modelId), {
          title: snapshot.title,
          description: snapshot.description,
          tags: [...snapshot.tags],
        });
        this.logger.log(`Search index job enqueued modelId=${model.modelId} projectId=${snapshot.projectId}`);
      } catch (error) {
        this.logger.warn(`Failed to enqueue search index for modelId=${model.modelId}: ${String(error)}`);
      }
    }
  }

  private async removeFromSearchIndex(projectId: string): Promise<void> {
    try {
      await this.index.markQueuedForProjectUnpublished(projectId);
    } catch (error) {
      this.logger.warn(`Failed to remove from search index projectId=${projectId}: ${String(error)}`);
    }
  }

  private async createFeedPost(snapshot: PublishedProjectSnapshot): Promise<void> {
    try {
      await this.feed.ensureModelLinkPost(ModelId(snapshot.primaryModelId), UserId(snapshot.actorId), snapshot.title);
      this.logger.log(`Feed post created or updated projectId=${snapshot.projectId}`);
    } catch (error) {
      this.logger.warn(`Failed to create feed post projectId=${snapshot.projectId}: ${String(error)}`);
    }
  }

}
