import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ImportsController } from "./api/imports.controller.ts";
import { ImportsService } from "./application/imports.service.ts";
import { ImportsRepository } from "./infrastructure/imports.repository.ts";
import { IMPORTS_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [ImportsController],
  providers: [ImportsRepository, ImportsService, { provide: IMPORTS_PORT, useExisting: ImportsService }],
  exports: [IMPORTS_PORT],
})
export class ImportsModule {}
