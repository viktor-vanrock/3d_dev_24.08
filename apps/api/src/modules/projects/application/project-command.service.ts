import { Inject, Injectable } from "@nestjs/common";
import type { ModelId, ProjectId, UserId } from "../../_kernel/brandedIds.ts";
import { sha256Canonical, type ModelCreateInput, type ProjectMetadataInput, type ProjectPatchInput } from "../domain/project.ts";
import type { ProjectRepository, UploadedSource } from "../domain/project.repository.ts";
import { PostgresProjectRepository } from "../infrastructure/postgres-project.repository.ts";

@Injectable()
export class ProjectCommandService {
  private readonly repository: ProjectRepository;

  constructor(@Inject(PostgresProjectRepository) repository: PostgresProjectRepository) {
    this.repository = repository;
  }

  createProject(actorId: UserId, input: ProjectMetadataInput, key: string) {
    return this.repository.createProject(actorId, input, key, sha256Canonical(input));
  }

  updateProject(actorId: UserId, projectId: ProjectId, version: number, patch: ProjectPatchInput) {
    return this.repository.updateProject(actorId, projectId, version, patch);
  }

  deleteProject(actorId: UserId, projectId: ProjectId, version: number) {
    return this.repository.deleteProject(actorId, projectId, version);
  }

  async createModel(actorId: UserId, projectId: ProjectId, version: number, input: ModelCreateInput, source: UploadedSource, key: string) {
    const fingerprint = sha256Canonical({ input, checksum: source.checksum.toString("hex"), size: source.sizeBytes, format: source.sourceFormat });
    return this.repository.createModel(actorId, projectId, version, input, source, key, fingerprint);
  }

  async createRevision(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number, source: UploadedSource, key: string) {
    const fingerprint = sha256Canonical({ checksum: source.checksum.toString("hex"), size: source.sizeBytes, format: source.sourceFormat });
    return this.repository.createRevision(actorId, projectId, modelId, version, source, key, fingerprint);
  }

  deleteModel(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number) {
    return this.repository.deleteModel(actorId, projectId, modelId, version);
  }

  setPrimary(actorId: UserId, projectId: ProjectId, modelId: ModelId, version: number) {
    return this.repository.setPrimary(actorId, projectId, modelId, version);
  }

  clearPrimary(actorId: UserId, projectId: ProjectId, version: number) {
    return this.repository.clearPrimary(actorId, projectId, version);
  }
}
