import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ProjectsController } from "./api/projects.controller.ts";
import { ProjectCommandService } from "./application/project-command.service.ts";
import { ProjectLifecycleService } from "./application/project-lifecycle.service.ts";
import { ProjectProcessingService } from "./application/project-processing.service.ts";
import { ProjectQueryService } from "./application/project-query.service.ts";
import { UploadConcurrencyService } from "./application/upload-concurrency.service.ts";
import { UploadCleanupService } from "./application/upload-cleanup.service.ts";
import { UploadService } from "./application/upload.service.ts";
import { PostgresProjectRepository } from "./infrastructure/postgres-project.repository.ts";
import { ProjectsOutboxRepository } from "./infrastructure/outbox.repository.ts";
import { UploadSessionRepository } from "./infrastructure/upload-session.repository.ts";
import { OUTBOX_PORT, PROJECT_COMMAND_SERVICE, PROJECT_PROCESSING_SERVICE, PROJECT_QUERY_SERVICE, UPLOAD_CONCURRENCY_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [ProjectsController],
  providers: [
    PostgresProjectRepository,
    ProjectsOutboxRepository,
    ProjectCommandService,
    ProjectLifecycleService,
    ProjectQueryService,
    ProjectProcessingService,
    UploadConcurrencyService,
    UploadSessionRepository,
    UploadService,
    UploadCleanupService,
    { provide: UPLOAD_CONCURRENCY_PORT, useExisting: UploadConcurrencyService },
    { provide: PROJECT_COMMAND_SERVICE, useExisting: ProjectCommandService },
    { provide: PROJECT_QUERY_SERVICE, useExisting: ProjectQueryService },
    { provide: PROJECT_PROCESSING_SERVICE, useExisting: ProjectProcessingService },
    { provide: OUTBOX_PORT, useExisting: ProjectsOutboxRepository },
  ],
  exports: [PROJECT_COMMAND_SERVICE, PROJECT_QUERY_SERVICE, PROJECT_PROCESSING_SERVICE, OUTBOX_PORT, UPLOAD_CONCURRENCY_PORT, ProjectLifecycleService],
})
export class ProjectsModule {}
