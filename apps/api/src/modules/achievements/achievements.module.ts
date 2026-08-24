import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { AchievementsController } from "./api/achievements.controller.ts";
import { AchievementsService } from "./application/achievements.service.ts";
import { AchievementsRepository } from "./infrastructure/achievements.repository.ts";
import { ACHIEVEMENTS_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AchievementsController],
  providers: [AchievementsRepository, AchievementsService, { provide: ACHIEVEMENTS_PORT, useExisting: AchievementsService }],
  exports: [ACHIEVEMENTS_PORT],
})
export class AchievementsModule {}
