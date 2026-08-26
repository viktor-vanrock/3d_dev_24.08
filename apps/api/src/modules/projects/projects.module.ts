import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ProjectsController } from "./api/projects.controller.ts";
import { ProjectCommandService } from "./application/project-command.service.ts";
import { ProjectProcessingService } from "./application/project-processing.service.ts";
import { ProjectQueryService } from "./application/project-query.service.ts";
import { PostgresProjectRepository } from "./infrastructure/postgres-project.repository.ts";
import { ProjectsOutboxRepository } from "./infrastructure/outbox.repository.ts";
import { OUTBOX_PORT, PROJECT_COMMAND_SERVICE, PROJECT_PROCESSING_SERVICE, PROJECT_QUERY_SERVICE } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [ProjectsController],
  providers: [
    PostgresProjectRepository,
    ProjectsOutboxRepository,
    ProjectCommandService,
    ProjectQueryService,
    ProjectProcessingService,
    { provide: PROJECT_COMMAND_SERVICE, useExisting: ProjectCommandService },
    { provide: PROJECT_QUERY_SERVICE, useExisting: ProjectQueryService },
    { provide: PROJECT_PROCESSING_SERVICE, useExisting: ProjectProcessingService },
    { provide: OUTBOX_PORT, useExisting: ProjectsOutboxRepository },
  ],
  exports: [PROJECT_COMMAND_SERVICE, PROJECT_QUERY_SERVICE, PROJECT_PROCESSING_SERVICE, OUTBOX_PORT],
})
export class ProjectsModule {}
