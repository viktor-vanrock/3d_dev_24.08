import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { AgentsController } from "./api/agents.controller.ts";
import { AgentsService } from "./application/agents.service.ts";
import { AgentsRepository } from "./infrastructure/agents.repository.ts";
import { AGENTS_PORT } from "./public/index.ts";
@Module({
  imports: [DatabaseModule],
  controllers: [AgentsController],
  providers: [AgentsRepository, AgentsService, { provide: AGENTS_PORT, useExisting: AgentsService }],
  exports: [AGENTS_PORT],
})
export class AgentsModule {}
