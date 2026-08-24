import { Module } from "@nestjs/common";
import { RelayApiModule } from "../api/api.module.ts";
import { CommandDeliveryModule } from "../commands/command-delivery.module.ts";
import { COMMAND_SESSION_PORT } from "../commands/command-session.port.ts";
import { SessionCommandPortAdapter } from "../session/session-command-port.adapter.ts";
import { SessionModule } from "../session/session.module.ts";
import { SessionTransferPortAdapter } from "../session/session-transfer-port.adapter.ts";
import { FileTransferModule } from "../transfers/file-transfer.module.ts";
import { TRANSFER_SESSION_PORT } from "../transfers/transfer-session.port.ts";
import { GatewayRuntime } from "./gateway-runtime.service.ts";

@Module({
  imports: [
    RelayApiModule,
    SessionModule,
    CommandDeliveryModule.register({ sessionPort: { provide: COMMAND_SESSION_PORT, useClass: SessionCommandPortAdapter } }),
    FileTransferModule.register({ sessionPort: { provide: TRANSFER_SESSION_PORT, useClass: SessionTransferPortAdapter } }),
  ],
  providers: [GatewayRuntime],
  exports: [GatewayRuntime],
})
export class GatewayModule {}
