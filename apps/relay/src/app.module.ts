import { Module } from "@nestjs/common";
import { RelayApiModule } from "./api/api.module.ts";
import { RelayConfigModule } from "./config/config.module.ts";
import { GatewayModule } from "./gateway/gateway.module.ts";
import { ObservabilityModule } from "./observability/observability.module.ts";

@Module({ imports: [RelayConfigModule, ObservabilityModule, RelayApiModule, GatewayModule] })
export class AppModule {}
