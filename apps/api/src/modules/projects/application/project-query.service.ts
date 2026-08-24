import { Inject, Injectable } from "@nestjs/common";
import { getModelObjectPresignedUrl } from "../../../storage/s3.ts";
import type { ModelId, ModelRevisionId, ProjectId, UserId } from "../../_kernel/brandedIds.ts";
import { decodeCursor, encodeCursor, type CursorPage } from "../domain/project.ts";
import { assetNotFound, modelNotFound, ProjectError, projectNotFound, revisionNotFound } from "../domain/project.errors.ts";
import type { ModelRevisionView, ModelView, ProjectRepository, ProjectView } from "../domain/project.repository.ts";
import { PostgresProjectRepository } from "../infrastructure/postgres-project.repository.ts";

function pageLimit(raw: number | undefined): number {
  return raw ?? 20;
}

function cursor(raw: string | undefined, parts: number): readonly unknown[] | null {
  const value = decodeCursor(raw, parts);
  if (raw !== undefined && value === null) throw new ProjectError(400, "request.validation.v1", "Некорректный cursor");
  return value;
}

function page<T>(rows: readonly T[], limit: number, token: (row: T) => readonly unknown[]) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, next_cursor: hasMore && last !== undefined ? encodeCursor(token(last)) : null };
}

@Injectable()
export class ProjectQueryService {
  private readonly repository: ProjectRepository;

  constructor(@Inject(PostgresProjectRepository) repository: PostgresProjectRepository) {
    this.repository = repository;
  }

  async listPublished(query: CursorPage) {
    const limit = pageLimit(query.limit);
    const rows = await this.repository.listPublished(limit, cursor(query.cursor, 2));
    return page<ProjectView>(rows, limit, (row) => [row.updated_at.toISOString(), row.id]);
  }

  async listOwned(actorId: UserId, query: CursorPage) {
    const limit = pageLimit(query.limit);
    const rows = await this.repository.listOwned(actorId, limit, cursor(query.cursor, 2));
    return page<ProjectView>(rows, limit, (row) => [row.updated_at.toISOString(), row.id]);
  }

  async published(projectId: ProjectId) {
    const value = await this.repository.getPublished(projectId);
    if (value === null) throw projectNotFound();
    return value;
  }

  async draft(actorId: UserId, projectId: ProjectId) {
    const value = await this.repository.getDraft(actorId, projectId);
    if (value === null) throw projectNotFound();
    return value;
  }

  async models(actorId: UserId, projectId: ProjectId, query: CursorPage) {
    const limit = pageLimit(query.limit);
    const rows = await this.repository.listModels(actorId, projectId, limit, cursor(query.cursor, 2));
    if (rows === null) throw projectNotFound();
    return page<ModelView>(rows, limit, (row) => [row.position, row.id]);
  }

  async model(actorId: UserId, projectId: ProjectId, modelId: ModelId) {
    const value = await this.repository.getModel(actorId, projectId, modelId);
    if (value === null) throw modelNotFound();
    return value;
  }

  async revisions(actorId: UserId, projectId: ProjectId, modelId: ModelId, query: CursorPage) {
    const limit = pageLimit(query.limit);
    const rows = await this.repository.listRevisions(actorId, projectId, modelId, limit, cursor(query.cursor, 2));
    if (rows === null) throw modelNotFound();
    return page<ModelRevisionView>(rows, limit, (row) => [row.created_at.toISOString(), row.id]);
  }

  async revision(actorId: UserId, projectId: ProjectId, modelId: ModelId, revisionId: ModelRevisionId) {
    const value = await this.repository.getRevision(actorId, projectId, modelId, revisionId);
    if (value === null) throw revisionNotFound();
    return value;
  }

  async asset(actorId: UserId | null, projectId: ProjectId, modelId: ModelId, revisionId: ModelRevisionId, role: "source" | "preview") {
    const key = await this.repository.revisionAsset(actorId, projectId, modelId, revisionId, role);
    if (key === null) throw assetNotFound();
    const url = await getModelObjectPresignedUrl(key);
    if (url === null) throw assetNotFound();
    return url;
  }
}
