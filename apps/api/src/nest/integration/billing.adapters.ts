import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { BillingNotConfiguredError, createPayment, fetchPayment, isBillingConfigured } from "../../modules/billing/public/index.ts";
import { AnalyticsModule } from "../../modules/analytics/analytics.module.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../modules/analytics/public/index.ts";
import { ModelsModule } from "../../modules/models/models.module.ts";
import { MODEL_READ_PORT, type ModelReadPort } from "../../modules/models/public/index.ts";
import { ProfileModule } from "../../modules/profile/profile.module.ts";
import { PROFILE_ADMIN_PORT, type ProfileAdminPort } from "../../modules/profile/public/index.ts";
import {
  BILLING_ANALYTICS_PORT,
  BILLING_MODEL_READ_PORT,
  BILLING_PROVIDER_PORT,
  BILLING_STAFF_PORT,
  BillingProviderNotConfiguredError,
  type BillingAnalyticsPort,
  type BillingModelReadPort,
  type BillingProviderPort,
  type BillingStaffPort,
} from "../../modules/billing/public/index.ts";

@Injectable()
export class BillingModelReadAdapter implements BillingModelReadPort {
  constructor(@Inject(MODEL_READ_PORT) private readonly models: ModelReadPort) {}
  findMany(ids: Parameters<BillingModelReadPort["findMany"]>[0]) {
    return this.models.findBillingModels(ids);
  }
}
@Injectable()
export class BillingStaffAdapter implements BillingStaffPort {
  constructor(@Inject(PROFILE_ADMIN_PORT) private readonly profiles: ProfileAdminPort) {}
  isStaff(id: Parameters<BillingStaffPort["isStaff"]>[0]) {
    return this.profiles.isStaff(id);
  }
}
@Injectable()
export class BillingAnalyticsAdapter implements BillingAnalyticsPort {
  constructor(@Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort) {}
  async purchased(input: Parameters<BillingAnalyticsPort["purchased"]>[0]) {
    await this.analytics.emitEvent({
      eventName: "purchase",
      userId: input.buyerId,
      anonId: null,
      props: {
        model_id: input.modelId,
        seller_id: input.sellerId,
        amount: input.amount,
      },
    });
  }
}
@Injectable()
export class BillingProviderAdapter implements BillingProviderPort {
  configured() {
    return isBillingConfigured();
  }
  async create(input: Parameters<BillingProviderPort["create"]>[0]) {
    try {
      const value = await createPayment({
        ...input,
        metadata: { ...input.metadata },
      });
      return { id: value.id, confirmationUrl: value.confirmationUrl };
    } catch (error) {
      if (error instanceof BillingNotConfiguredError) throw new BillingProviderNotConfiguredError();
      throw error;
    }
  }
  async fetch(paymentId: string) {
    try {
      return await fetchPayment(paymentId);
    } catch (error) {
      if (error instanceof BillingNotConfiguredError) throw new BillingProviderNotConfiguredError();
      throw error;
    }
  }
}
@Global()
@Module({
  imports: [ModelsModule, ProfileModule, AnalyticsModule],
  providers: [
    BillingModelReadAdapter,
    BillingStaffAdapter,
    BillingAnalyticsAdapter,
    BillingProviderAdapter,
    { provide: BILLING_MODEL_READ_PORT, useExisting: BillingModelReadAdapter },
    { provide: BILLING_STAFF_PORT, useExisting: BillingStaffAdapter },
    { provide: BILLING_ANALYTICS_PORT, useExisting: BillingAnalyticsAdapter },
    { provide: BILLING_PROVIDER_PORT, useExisting: BillingProviderAdapter },
  ],
  exports: [BILLING_MODEL_READ_PORT, BILLING_STAFF_PORT, BILLING_ANALYTICS_PORT, BILLING_PROVIDER_PORT],
})
export class BillingIntegrationModule {}
