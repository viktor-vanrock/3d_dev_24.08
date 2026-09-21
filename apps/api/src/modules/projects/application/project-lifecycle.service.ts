import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ProjectId, UserId } from "../../_kernel/brandedIds.ts";
import { ProjectError } from "../domain/project.errors.ts";
import { getAllowedEvents, getTransition, PROJECT_EVENT, type ProjectEvent, type ProjectStatus, type ProjectVisibility, type TransitionResult } from "../domain/project-lifecycle.types.ts";
import type { ProjectRepository } from "../domain/project.repository.ts";
import { PostgresProjectRepository } from "../infrastructure/postgres-project.repository.ts";
import { PublicationEventsService } from "./publication-events.service.ts";

export class InvalidTransitionError extends ProjectError {
  constructor(from: ProjectStatus, event: ProjectEvent) {
    super(400, "project.invalid_transition.v1", `Переход '${event}' недопустим для статуса '${from}'`);
    this.name = "InvalidTransitionError";
  }
}

export interface PublishCommand {
  readonly confirmed: true;
}

@Injectable()
export class ProjectLifecycleService {
  private readonly logger = new Logger(ProjectLifecycleService.name);
  private readonly repository: ProjectRepository;

  constructor(@Inject(PostgresProjectRepository) repository: PostgresProjectRepository, @Inject(PublicationEventsService) private readonly events: PublicationEventsService) {
    this.repository = repository;
  }

  async transition(actorId: UserId, projectId: ProjectId, event: ProjectEvent, version: number): Promise<{ readonly version: number }> {
    const project = await this.repository.getDraft(actorId, projectId);
    if (project === null) throw new ProjectError(404, "project.not_found.v1", "Проект не найден");
    const transition = getTransition(project.status, event);
    if (transition === null) throw new InvalidTransitionError(project.status, event);
    return this.applyTransition(actorId, projectId, event, transition, version);
  }

  startUpload(actorId: UserId, projectId: ProjectId, version: number) {
    return this.transition(actorId, projectId, PROJECT_EVENT.START_UPLOAD, version);
  }

  completeUpload(actorId: UserId, projectId: ProjectId, version: number) {
    return this.transition(actorId, projectId, PROJECT_EVENT.UPLOAD_COMPLETE, version);
  }

  failUpload(actorId: UserId, projectId: ProjectId, version: number) {
    return this.transition(actorId, projectId, PROJECT_EVENT.UPLOAD_FAILED, version);
  }

  submitForReview(actorId: UserId, projectId: ProjectId, version: number) {
    return this.transition(actorId, projectId, PROJECT_EVENT.SUBMIT_FOR_REVIEW, version);
  }

  async publish(actorId: UserId, projectId: ProjectId, version: number, cmd: PublishCommand) {
    void cmd;
    const project = await this.repository.getDraft(actorId, projectId);
    if (project === null) throw new ProjectError(404, "project.not_found.v1", "Проект не найден");
    const transition = getTransition(project.status, PROJECT_EVENT.PUBLISH);
    if (transition === null) throw new InvalidTransitionError(project.status, PROJECT_EVENT.PUBLISH);
    const publication = await this.repository.publish(actorId, projectId, version, { status: transition.toStatus, visibility: transition.toVisibility, publishedAt: new Date() });
    void this.dispatchPublishEvents(actorId, projectId, publication.value.project_revision_id).catch((error) =>
      this.logger.error(`afterPublish failed projectId=${projectId}: ${String(error)}`),
    );
    this.logger.log(`Published project=${projectId} actor=${actorId}`);
    return publication;
  }

  async unpublish(actorId: UserId, projectId: ProjectId, version: number): Promise<number> {
    const project = await this.repository.getDraft(actorId, projectId);
    if (project === null) throw new ProjectError(404, "project.not_found.v1", "Проект не найден");
    const transition = getTransition(project.status, PROJECT_EVENT.UNPUBLISH);
    if (transition === null) throw new InvalidTransitionError(project.status, PROJECT_EVENT.UNPUBLISH);
    const result = await this.repository.unpublish(actorId, projectId, version, { status: transition.toStatus, visibility: transition.toVisibility });
    void this.events.afterUnpublish({ projectId, actorId, version: result }).catch((error) =>
      this.logger.error(`afterUnpublish failed projectId=${projectId}: ${String(error)}`),
    );
    this.logger.log(`Unpublished project=${projectId} actor=${actorId}`);
    return result;
  }

  async archive(actorId: UserId, projectId: ProjectId, version: number): Promise<{ readonly version: number }> {
    const result = await this.transition(actorId, projectId, PROJECT_EVENT.ARCHIVE, version);
    this.logger.log(`Archived project=${projectId} actor=${actorId}`);
    return result;
  }

  async restore(actorId: UserId, projectId: ProjectId, version: number): Promise<{ readonly version: number }> {
    return this.transition(actorId, projectId, PROJECT_EVENT.RESTORE, version);
  }

  getAllowedEvents(status: ProjectStatus): ProjectEvent[] {
    return getAllowedEvents(status);
  }

  private async dispatchPublishEvents(actorId: UserId, projectId: ProjectId, revisionId: string): Promise<void> {
    const published = await this.repository.getPublished(projectId);
    if (published === null || published.project_revision_id !== revisionId) {
      this.logger.warn(`afterPublish skipped: published snapshot changed projectId=${projectId}`);
      return;
    }
    await this.events.afterPublish({
      projectId,
      revisionId,
      actorId,
      title: published.title,
      description: published.description,
      tags: published.tags,
      primaryModelId: published.primary_model_id ?? published.published_models[0]?.id ?? "",
      models: published.published_models.map((model) => ({ modelId: model.id, revisionId: model.active_revision_id ?? model.latest_revision_id })),
    });
  }

  private applyTransition(
    actorId: UserId,
    projectId: ProjectId,
    event: ProjectEvent,
    transition: TransitionResult,
    version: number,
  ): Promise<{ readonly version: number }> {
    const params: { status: ProjectStatus; visibility: ProjectVisibility; publishedAt?: Date | null; archivedAt?: Date | null } = {
      status: transition.toStatus,
      visibility: transition.toVisibility,
    };
    if (transition.setPublishedAt === "now") params.publishedAt = new Date();
    if (transition.setPublishedAt === "null") params.publishedAt = null;
    if (event === PROJECT_EVENT.ARCHIVE) params.archivedAt = new Date();
    if (event === PROJECT_EVENT.RESTORE) params.archivedAt = null;
    return this.repository.updateLifecycleStatus(projectId, actorId, params, version);
  }
}
