import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ImportConnectionsController } from "./api/import-connections.controller.ts";
import { ImportConnectionsService } from "./application/import-connections.service.ts";
import { ImportConnectionsRepository } from "./infrastructure/import-connections.repository.ts";
import { IMPORT_CONNECTIONS_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [ImportConnectionsController],
  providers: [ImportConnectionsRepository, ImportConnectionsService, { provide: IMPORT_CONNECTIONS_PORT, useExisting: ImportConnectionsService }],
  exports: [IMPORT_CONNECTIONS_PORT],
})
export class ImportConnectionsModule {}
