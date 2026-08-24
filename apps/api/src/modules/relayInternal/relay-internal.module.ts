import { Module } from "@nestjs/common";
import { DEVICE_RELAY_CONTROL_PORT } from "../devices/public/index.ts";
import { RelayInternalController } from "./api/relay-internal.controller.ts";
import { RelayInternalExceptionFilter } from "./api/relay-internal.filter.ts";
import { RelayServiceGuard } from "./api/relay-service.guard.ts";
import { RelayInternalService } from "./application/relay-internal.service.ts";
import { RELAY_CONTROL_PORT } from "./public/index.ts";

@Module({
  controllers: [RelayInternalController],
  providers: [RelayInternalService, RelayServiceGuard, RelayInternalExceptionFilter, { provide: RELAY_CONTROL_PORT, useExisting: DEVICE_RELAY_CONTROL_PORT }],
})
export class RelayInternalModule {}
