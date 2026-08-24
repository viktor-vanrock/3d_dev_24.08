import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { CatalogController } from "./api/catalog.controller.ts";
import { CatalogService } from "./application/catalog.service.ts";
import { CatalogReadRepository } from "./infrastructure/catalog-read.repository.ts";
import { CatalogMakesRepository } from "./infrastructure/catalog-makes.repository.ts";
import { CatalogCandidatesRepository } from "./infrastructure/catalog-candidates.repository.ts";
import { CATALOG_MAKES_PORT, CATALOG_PORT, CATALOG_READ_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [CatalogController],
  providers: [
    CatalogReadRepository,
    CatalogMakesRepository,
    CatalogCandidatesRepository,
    CatalogService,
    { provide: CATALOG_READ_PORT, useExisting: CatalogReadRepository },
    { provide: CATALOG_MAKES_PORT, useExisting: CatalogMakesRepository },
    { provide: CATALOG_PORT, useExisting: CatalogService },
  ],
  exports: [CATALOG_READ_PORT, CATALOG_MAKES_PORT, CATALOG_PORT],
})
export class CatalogModule {}
