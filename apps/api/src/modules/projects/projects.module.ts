import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { SessionVerifier } from "../../nest/auth/session-verifier.ts";
import { ProjectsController } from "./api/projects.controller.ts";
import { ProjectCommandService } from "./application/project-command.service.ts";
import { ProjectProcessingService } from "./application/project-processing.service.ts";
import { ProjectQueryService } from "./application/project-query.service.ts";
import { PostgresProjectRepository } from "./infrastructure/postgres-project.repository.ts";
import { PROJECT_COMMAND_SERVICE, PROJECT_PROCESSING_SERVICE, PROJECT_QUERY_SERVICE } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [ProjectsController],
  providers: [
    SessionVerifier,
    PostgresProjectRepository,
    ProjectCommandService,
    ProjectQueryService,
    ProjectProcessingService,
    { provide: PROJECT_COMMAND_SERVICE, useExisting: ProjectCommandService },
    { provide: PROJECT_QUERY_SERVICE, useExisting: ProjectQueryService },
    { provide: PROJECT_PROCESSING_SERVICE, useExisting: ProjectProcessingService },
  ],
  exports: [PROJECT_COMMAND_SERVICE, PROJECT_QUERY_SERVICE, PROJECT_PROCESSING_SERVICE],
})
export class ProjectsModule {}
