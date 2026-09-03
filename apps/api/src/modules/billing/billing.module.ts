import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { BillingController } from "./api/billing.controller.ts";
import { BillingService } from "./application/billing.service.ts";
import { BillingRepository } from "./infrastructure/billing.repository.ts";
import { BILLING_PORT } from "./public/index.ts";
import { PermissionsModule } from "../permissions/public/index.ts";
@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [BillingController],
  providers: [BillingRepository, BillingService, { provide: BILLING_PORT, useExisting: BillingService }],
  exports: [BILLING_PORT],
})
export class BillingModule {}
