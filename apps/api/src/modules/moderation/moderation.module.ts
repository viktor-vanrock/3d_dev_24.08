import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ReportsRepository } from "./infrastructure/reports.repository.ts";
import { REPORTS_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [ReportsRepository, { provide: REPORTS_PORT, useExisting: ReportsRepository }],
  exports: [REPORTS_PORT],
})
export class ModerationModule {}
