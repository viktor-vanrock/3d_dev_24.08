import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ModerationController } from "./api/moderation.controller.ts";
import { ModerationService } from "./application/moderation.service.ts";
import { ReportsRepository } from "./infrastructure/reports.repository.ts";
import { MODERATION_PORT, REPORTS_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [ModerationController],
  providers: [ModerationService, ReportsRepository, { provide: MODERATION_PORT, useExisting: ModerationService }, { provide: REPORTS_PORT, useExisting: ReportsRepository }],
  exports: [MODERATION_PORT, REPORTS_PORT],
})
export class ModerationModule {}
