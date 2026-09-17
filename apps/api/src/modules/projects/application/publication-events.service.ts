import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
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
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(MODEL_INDEX_PORT) private readonly index: ModelIndexPort,
    @Inject(FEED_SOCIAL_OWNER_PORT) private readonly feed: FeedSocialOwnerPort,
  ) {}

  /** Runs after the publication transaction committed; failures are deliberately isolated. */
  async afterPublish(snapshot: PublishedProjectSnapshot): Promise<void> {
    await Promise.allSettled([this.enqueueSearchIndex(snapshot), this.createFeedPost(snapshot), this.writeAuditLog(snapshot)]);
  }

  /** Runs after unpublishing committed; failures are deliberately isolated. */
  async afterUnpublish(params: { readonly projectId: string; readonly actorId: string; readonly version: number }): Promise<void> {
    await Promise.allSettled([this.removeFromSearchIndex(params.projectId), this.writeUnpublishAudit(params)]);
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

  private async writeAuditLog(snapshot: PublishedProjectSnapshot): Promise<void> {
    try {
      await this.pool.query(
        `with locked as (
           select pg_advisory_xact_lock(hashtext('project-published-audit:' || $2::text)) as acquired
         )
         insert into audit_log (actor_user_id, action, target_type, target_id, details)
         select $1, 'project.published', 'project', $2, $3::jsonb from locked
          where not exists (
            select 1 from audit_log
             where action = 'project.published' and target_type = 'project' and target_id = $2
               and details ->> 'revision_id' = $4
          )`,
        [snapshot.actorId, snapshot.projectId, JSON.stringify({ revision_id: snapshot.revisionId, title: snapshot.title, models_count: snapshot.models.length }), snapshot.revisionId],
      );
    } catch (error) {
      this.logger.warn(`Failed to write audit log projectId=${snapshot.projectId}: ${String(error)}`);
    }
  }

  private async writeUnpublishAudit(params: { readonly projectId: string; readonly actorId: string; readonly version: number }): Promise<void> {
    try {
      await this.pool.query(
        `with locked as (
           select pg_advisory_xact_lock(hashtext('project-unpublished-audit:' || $2::text)) as acquired
         )
         insert into audit_log (actor_user_id, action, target_type, target_id, details)
         select $1, 'project.unpublished', 'project', $2, $3::jsonb from locked
          where not exists (
            select 1 from audit_log
             where action = 'project.unpublished' and target_type = 'project' and target_id = $2
               and details ->> 'version' = $4
          )`,
        [params.actorId, params.projectId, JSON.stringify({ version: params.version }), String(params.version)],
      );
    } catch (error) {
      this.logger.warn(`Failed to write unpublish audit projectId=${params.projectId}: ${String(error)}`);
    }
  }
}
