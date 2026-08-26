import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { SanctionRelayOutboxDispatcher } from "./application/sanction-relay-outbox-dispatcher.ts";
import { AppealsService } from "./application/appeals.service.ts";
import { AppealsController } from "./api/appeals.controller.ts";
import { SanctionsController } from "./api/sanctions.controller.ts";
import { SanctionsService } from "./application/sanctions.service.ts";
import { SanctionsRepository } from "./infrastructure/sanctions.repository.ts";
import { SANCTION_APPEALS_PORT, SANCTIONS_PORT, SANCTIONS_READ_PORT, SANCTIONS_RELAY_DISPATCH_PORT } from "./public/index.ts";
@Global()
@Module({ imports: [DatabaseModule], controllers: [SanctionsController, AppealsController], providers: [SanctionsRepository, SanctionsService, AppealsService, SanctionRelayOutboxDispatcher, { provide: SANCTIONS_READ_PORT, useExisting: SanctionsRepository }, { provide: SANCTIONS_PORT, useExisting: SanctionsService }, { provide: SANCTION_APPEALS_PORT, useExisting: AppealsService }, { provide: SANCTIONS_RELAY_DISPATCH_PORT, useExisting: SanctionRelayOutboxDispatcher }], exports: [SANCTIONS_READ_PORT, SANCTIONS_PORT, SANCTION_APPEALS_PORT, SANCTIONS_RELAY_DISPATCH_PORT] })
export class SanctionsModule {}
