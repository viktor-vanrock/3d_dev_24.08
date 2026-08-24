import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { PrinterCatalogRepository } from "./infrastructure/printer-catalog.repository.ts";
import { PRINTER_CATALOG_READ_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  providers: [PrinterCatalogRepository, { provide: PRINTER_CATALOG_READ_PORT, useExisting: PrinterCatalogRepository }],
  exports: [PRINTER_CATALOG_READ_PORT],
})
export class PrinterCatalogOwnerModule {}
