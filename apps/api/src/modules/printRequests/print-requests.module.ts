import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { PrintRequestsController } from "./api/print-requests.controller.ts";
import { PrintRequestsService } from "./application/print-requests.service.ts";
import { PrintRequestsRepository } from "./infrastructure/print-requests.repository.ts";
import { PRINT_REQUESTS_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [PrintRequestsController],
  providers: [PrintRequestsRepository, PrintRequestsService, { provide: PRINT_REQUESTS_PORT, useExisting: PrintRequestsService }],
  exports: [PRINT_REQUESTS_PORT],
})
export class PrintRequestsModule {}
