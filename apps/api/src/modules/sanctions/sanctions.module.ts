import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { SanctionRelayOutboxDispatcher } from "./application/sanction-relay-outbox-dispatcher.ts";
import { SanctionsService } from "./application/sanctions.service.ts";
import { SanctionsRepository } from "./infrastructure/sanctions.repository.ts";
import { SANCTIONS_PORT, SANCTIONS_READ_PORT, SANCTIONS_RELAY_DISPATCH_PORT } from "./public/index.ts";
@Module({ imports: [DatabaseModule], providers: [SanctionsRepository, SanctionsService, SanctionRelayOutboxDispatcher, { provide: SANCTIONS_READ_PORT, useExisting: SanctionsRepository }, { provide: SANCTIONS_PORT, useExisting: SanctionsService }, { provide: SANCTIONS_RELAY_DISPATCH_PORT, useExisting: SanctionRelayOutboxDispatcher }], exports: [SANCTIONS_READ_PORT, SANCTIONS_PORT, SANCTIONS_RELAY_DISPATCH_PORT] })
export class SanctionsModule {}
