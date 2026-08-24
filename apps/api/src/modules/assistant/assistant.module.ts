import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { AssistantController } from "./api/assistant.controller.ts";
import { AssistantService } from "./application/assistant.service.ts";
import { AssistantRepository } from "./infrastructure/assistant.repository.ts";
import { ASSISTANT_INCIDENT_PORT, ASSISTANT_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [AssistantController],
  providers: [
    AssistantRepository,
    AssistantService,
    { provide: ASSISTANT_PORT, useExisting: AssistantService },
    { provide: ASSISTANT_INCIDENT_PORT, useExisting: AssistantRepository },
  ],
  exports: [ASSISTANT_PORT, ASSISTANT_INCIDENT_PORT],
})
export class AssistantModule {}
