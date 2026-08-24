import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { RelayApiModule } from "../api/api.module.ts";
import { ObservabilityModule } from "../observability/observability.module.ts";
import { COMMAND_DELIVERY_OPTIONS, CommandDeliveryService, type CommandDeliveryOptions } from "./command-delivery.service.ts";

export interface CommandDeliveryModuleOptions {
  /** Provider whose token is COMMAND_SESSION_PORT. */
  readonly sessionPort: Provider;
  readonly delivery?: Partial<CommandDeliveryOptions>;
}

@Module({})
export class CommandDeliveryModule {
  static register(options: CommandDeliveryModuleOptions): DynamicModule {
    return {
      module: CommandDeliveryModule,
      imports: [RelayApiModule, ObservabilityModule],
      providers: [
        options.sessionPort,
        { provide: COMMAND_DELIVERY_OPTIONS, useValue: options.delivery ?? {} },
        CommandDeliveryService,
      ],
      exports: [CommandDeliveryService],
    };
  }
}
