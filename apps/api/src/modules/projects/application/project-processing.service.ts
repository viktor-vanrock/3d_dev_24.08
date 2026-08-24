import { Inject, Injectable } from "@nestjs/common";
import type { ModelRevisionId } from "../../_kernel/brandedIds.ts";
import type { ProjectRepository } from "../domain/project.repository.ts";
import { PostgresProjectRepository } from "../infrastructure/postgres-project.repository.ts";
import type { ProjectProcessingPort } from "../public/index.ts";

@Injectable()
export class ProjectProcessingService implements ProjectProcessingPort {
  private readonly repository: ProjectRepository;

  constructor(@Inject(PostgresProjectRepository) repository: PostgresProjectRepository) {
    this.repository = repository;
  }

  markPending(revisionId: ModelRevisionId) {
    return this.repository.transitionRevision(revisionId, "uploaded", "pending");
  }
  markProcessing(revisionId: ModelRevisionId) {
    return this.repository.transitionRevision(revisionId, "pending", "processing");
  }
  markReady(revisionId: ModelRevisionId) {
    return this.repository.transitionRevision(revisionId, "processing", "ready");
  }
  markFailed(revisionId: ModelRevisionId, code: string, detailSafe?: string) {
    return this.repository.transitionRevision(revisionId, "processing", "failed", { code, ...(detailSafe === undefined ? {} : { detailSafe }) });
  }
}
