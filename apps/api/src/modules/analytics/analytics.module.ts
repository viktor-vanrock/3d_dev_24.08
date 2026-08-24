import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { AnalyticsController } from "./api/analytics.controller.ts";
import { AnalyticsService } from "./application/analytics.service.ts";
import { AnalyticsRepository } from "./infrastructure/analytics.repository.ts";
import { ANALYTICS_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsRepository, AnalyticsService, { provide: ANALYTICS_PORT, useExisting: AnalyticsService }],
  exports: [ANALYTICS_PORT],
})
export class AnalyticsModule {}
