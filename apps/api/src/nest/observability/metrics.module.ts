import { Global, Module } from "@nestjs/common";
import { MetricsController } from "./metrics.controller.ts";
import { MetricsService } from "./metrics.service.ts";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
