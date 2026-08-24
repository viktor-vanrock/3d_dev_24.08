import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { ImportConnectionsModule } from "../../modules/importConnections/import-connections.module.ts";
import { IMPORT_CONNECTIONS_PORT, type ImportConnectionsPort } from "../../modules/importConnections/public/index.ts";
import { IMPORTS_CONNECTION_READ_PORT, IMPORTS_MODEL_OWNER_PORT, type ImportsConnectionReadPort } from "../../modules/imports/public/index.ts";
import { ModelsModule } from "../../modules/models/models.module.ts";
import { MODEL_OWNER_PORT } from "../../modules/models/public/index.ts";
import { ImportConnectionsIntegrationModule } from "./import-connections.adapters.ts";

@Injectable()
export class ImportsConnectionReadAdapter implements ImportsConnectionReadPort {
  constructor(@Inject(IMPORT_CONNECTIONS_PORT) private readonly connections: ImportConnectionsPort) {}

  exists(input: Parameters<ImportsConnectionReadPort["exists"]>[0]): Promise<boolean> {
    return this.connections.exists(input);
  }
}

@Global()
@Module({
  imports: [ModelsModule, ImportConnectionsIntegrationModule, ImportConnectionsModule],
  providers: [
    ImportsConnectionReadAdapter,
    { provide: IMPORTS_CONNECTION_READ_PORT, useExisting: ImportsConnectionReadAdapter },
    { provide: IMPORTS_MODEL_OWNER_PORT, useExisting: MODEL_OWNER_PORT },
  ],
  exports: [IMPORTS_CONNECTION_READ_PORT, IMPORTS_MODEL_OWNER_PORT],
})
export class ImportsIntegrationModule {}
