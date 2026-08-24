import { Global, Module } from "@nestjs/common";
import { CorrelationContext } from "./correlation-context.ts";
import { HealthController } from "./health.controller.ts";
import { MetricsController } from "./metrics.controller.ts";
import { RelayLogger } from "./relay-logger.ts";
import { RelayMetrics } from "./metrics.service.ts";
import { RuntimeState } from "./runtime-state.service.ts";

@Global()
@Module({
  controllers: [HealthController, MetricsController],
  providers: [CorrelationContext, RelayLogger, RelayMetrics, RuntimeState],
  exports: [CorrelationContext, RelayLogger, RelayMetrics, RuntimeState],
})
export class ObservabilityModule {}
