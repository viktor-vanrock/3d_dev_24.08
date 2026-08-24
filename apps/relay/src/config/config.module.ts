import { Global, Module } from "@nestjs/common";
import { loadRelayConfig, RELAY_CONFIG } from "./relay-config.ts";

@Global()
@Module({
  providers: [{ provide: RELAY_CONFIG, useFactory: loadRelayConfig }],
  exports: [RELAY_CONFIG],
})
export class RelayConfigModule {}
