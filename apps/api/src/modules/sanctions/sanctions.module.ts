import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { SanctionsRepository } from "./infrastructure/sanctions.repository.ts";
import { SANCTIONS_READ_PORT } from "./public/index.ts";
@Module({ imports: [DatabaseModule], providers: [SanctionsRepository, { provide: SANCTIONS_READ_PORT, useExisting: SanctionsRepository }], exports: [SANCTIONS_READ_PORT] })
export class SanctionsModule {}
