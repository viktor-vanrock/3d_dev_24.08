import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { PrintersController } from "./api/printers.controller.ts";
import { PrintersService } from "./application/printers.service.ts";
import { PrintersRepository } from "./infrastructure/printers.repository.ts";
import { PRINTER_OWNER_PORT, PRINTER_PROFILE_READ_PORT, PRINTER_RELAY_PORT, PRINTERS_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [PrintersController],
  providers: [
    PrintersRepository,
    PrintersService,
    { provide: PRINTERS_PORT, useExisting: PrintersService },
    { provide: PRINTER_OWNER_PORT, useExisting: PrintersRepository },
    { provide: PRINTER_PROFILE_READ_PORT, useExisting: PrintersRepository },
    { provide: PRINTER_RELAY_PORT, useExisting: PrintersRepository },
  ],
  exports: [PRINTERS_PORT, PRINTER_OWNER_PORT, PRINTER_PROFILE_READ_PORT, PRINTER_RELAY_PORT],
})
export class PrintersModule {}
