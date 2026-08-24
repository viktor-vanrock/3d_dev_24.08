import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import { CATALOG_EXTERNAL_PORT, type CatalogExternalPort, type CatalogQuery } from "../../modules/catalog/public/index.ts";
import { ensureCatalogCommunity } from "../../modules/community/public/index.ts";
import { getMachineMakeStats, getMaterialMakeStats, listMakesByMachine, listMakesByMaterial } from "../../modules/makes/public/index.ts";
import { PRINTER_CATALOG_READ_PORT, type PrinterCatalogReadPort } from "../../modules/printers/public/index.ts";
import { PrinterCatalogOwnerModule } from "../../modules/printers/printer-catalog-owner.module.ts";
import { assertNestRateLimit } from "./rate-limit.ts";

@Injectable()
export class CatalogExternalAdapter implements CatalogExternalPort {
  constructor(@Inject(PRINTER_CATALOG_READ_PORT) private readonly printersOwner: PrinterCatalogReadPort) {}

  async machineMakes(machineId: string, limit: number, offset: number) {
    const [stats, listing] = await Promise.all([getMachineMakeStats(machineId), listMakesByMachine(machineId, limit, offset)]);
    return { stats, listing };
  }

  async materialMakes(materialId: string, limit: number, offset: number) {
    const [stats, listing] = await Promise.all([getMaterialMakeStats(materialId), listMakesByMaterial(materialId, limit, offset)]);
    return { stats, listing };
  }

  assertCandidateSuggestRateLimit(request: unknown, userId: string): Promise<void> {
    return assertNestRateLimit(request as Request, "candidate_suggest", userId);
  }

  async ensureCatalogCommunity(kind: "vendor" | "machine", subjectId: string, name: string): Promise<void> {
    await ensureCatalogCommunity(kind, subjectId, name);
  }

  printers(input: CatalogQuery) {
    return this.printersOwner.list(input);
  }

  printer(slug: string) {
    return this.printersOwner.detail(slug);
  }
}

@Global()
@Module({
  imports: [PrinterCatalogOwnerModule],
  providers: [CatalogExternalAdapter, { provide: CATALOG_EXTERNAL_PORT, useExisting: CatalogExternalAdapter }],
  exports: [CATALOG_EXTERNAL_PORT],
})
export class CatalogIntegrationModule {}
