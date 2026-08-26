import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { RuntimeLogger } from "../../nest/observability/runtime-logger.ts";
import { DevicesController } from "./api/devices.controller.ts";
import { DevicesService } from "./application/devices.service.ts";
import { DeviceCommandRelayRepository } from "./infrastructure/device-command-relay.repository.ts";
import { DevicesRepository } from "./infrastructure/devices.repository.ts";
import { RelayControlRepository } from "./infrastructure/relay-control.repository.ts";
import { RelayControlClient } from "./infrastructure/relay-control-client.ts";
import {
  DEVICES_PORT,
  DEVICE_COMMAND_RELAY_PORT,
  DEVICE_INCIDENT_EVENT_READ_PORT,
  DEVICE_INCIDENT_EVENT_WRITE_PORT,
  DEVICE_PROFILE_OPERATIONS_PORT,
  DEVICE_PUBLIC_API_OPERATIONS_PORT,
  DEVICE_RELAY_CONTROL_PORT,
  DEVICE_ADMIN_PORT,
  DEVICE_RELAY_PUSH_PORT,
  DEVICE_SANCTIONS_PORT,
} from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [DevicesController],
  providers: [
    RuntimeLogger,
    DevicesRepository,
    DeviceCommandRelayRepository,
    RelayControlRepository,
    RelayControlClient,
    DevicesService,
    { provide: DEVICES_PORT, useExisting: DevicesService },
    { provide: DEVICE_PROFILE_OPERATIONS_PORT, useExisting: DevicesService },
    { provide: DEVICE_PUBLIC_API_OPERATIONS_PORT, useExisting: DevicesService },
    { provide: DEVICE_INCIDENT_EVENT_READ_PORT, useExisting: DevicesRepository },
    { provide: DEVICE_INCIDENT_EVENT_WRITE_PORT, useExisting: DevicesRepository },
    { provide: DEVICE_COMMAND_RELAY_PORT, useExisting: DeviceCommandRelayRepository },
    { provide: DEVICE_RELAY_CONTROL_PORT, useExisting: RelayControlRepository },
    { provide: DEVICE_ADMIN_PORT, useExisting: DevicesService },
    { provide: DEVICE_RELAY_PUSH_PORT, useExisting: RelayControlClient },
    { provide: DEVICE_SANCTIONS_PORT, useExisting: DevicesRepository },
  ],
  exports: [
    DEVICES_PORT,
    DEVICE_PROFILE_OPERATIONS_PORT,
    DEVICE_PUBLIC_API_OPERATIONS_PORT,
    DEVICE_INCIDENT_EVENT_READ_PORT,
    DEVICE_INCIDENT_EVENT_WRITE_PORT,
    DEVICE_COMMAND_RELAY_PORT,
    DEVICE_RELAY_CONTROL_PORT,
    DEVICE_ADMIN_PORT,
    DEVICE_RELAY_PUSH_PORT,
    DEVICE_SANCTIONS_PORT,
  ],
})
export class DevicesModule {}
