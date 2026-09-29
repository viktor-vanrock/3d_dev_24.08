import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ReportsRepository } from "./infrastructure/reports.repository.ts";
import { REPORTS_PORT } from "./public/index.ts";
import { ModerationController } from "./api/moderation.controller.ts";
import { ModerationService } from "./application/moderation.service.ts";
import { ContentRestrictionsRepository } from "./infrastructure/content-restrictions.repository.ts";
import { FlagClaimsRepository } from "./infrastructure/flag-claims.repository.ts";
import { FlagsRepository } from "./infrastructure/flags.repository.ts";
import { ModerationDecisionsRepository } from "./infrastructure/moderation-decisions.repository.ts";
import { CONTENT_RESTRICTIONS_PORT, FLAG_CLAIMS_PORT, FLAGS_PORT, MODERATION_DECISIONS_PORT } from "./domain/moderation.ports.ts";
import { AuditModule } from "../audit/audit.module.ts";
import { SanctionsModule } from "../sanctions/sanctions.module.ts";
import { PermissionsModule } from "../permissions/permissions.module.ts";

@Global()
@Module({
  imports: [DatabaseModule, AuditModule, SanctionsModule, PermissionsModule], controllers: [ModerationController],
  providers: [ReportsRepository, FlagsRepository, FlagClaimsRepository, ModerationDecisionsRepository, ContentRestrictionsRepository, ModerationService, { provide: REPORTS_PORT, useExisting: ReportsRepository }, { provide: FLAGS_PORT, useExisting: FlagsRepository }, { provide: FLAG_CLAIMS_PORT, useExisting: FlagClaimsRepository }, { provide: MODERATION_DECISIONS_PORT, useExisting: ModerationDecisionsRepository }, { provide: CONTENT_RESTRICTIONS_PORT, useExisting: ContentRestrictionsRepository }],
  exports: [REPORTS_PORT, CONTENT_RESTRICTIONS_PORT],
})
export class ModerationModule {}
