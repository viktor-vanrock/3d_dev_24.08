import type { ModelId, UserId } from "../../_kernel/brandedIds.ts";

export const BILLING_PORT = Symbol("BILLING_PORT");
export { hasDownloadEntitlement } from "../infrastructure/model-entitlement.ts";
export const BILLING_PROVIDER_PORT = Symbol("BILLING_PROVIDER_PORT");
export const BILLING_MODEL_READ_PORT = Symbol("BILLING_MODEL_READ_PORT");
export const BILLING_STAFF_PORT = Symbol("BILLING_STAFF_PORT");
export const BILLING_ANALYTICS_PORT = Symbol("BILLING_ANALYTICS_PORT");

export class BillingProviderNotConfiguredError extends Error {}

export interface BillingModel {
  readonly id: ModelId;
  readonly ownerId: UserId;
  readonly title: string;
  readonly priceMinor: number;
  readonly currency: string;
  readonly publishStatus: string;
}

export interface BillingModelReadPort {
  findMany(modelIds: readonly ModelId[]): Promise<ReadonlyMap<ModelId, BillingModel>>;
}

export interface BillingProviderPort {
  configured(): boolean;
  create(input: {
    readonly amountMinor: number;
    readonly currency: string;
    readonly description: string;
    readonly returnUrl: string;
    readonly idempotenceKey: string;
    readonly metadata: Readonly<Record<string, string>>;
  }): Promise<{ readonly id: string; readonly confirmationUrl: string | null }>;
  fetch(paymentId: string): Promise<{ readonly status: string }>;
}

export interface BillingStaffPort {
  isStaff(userId: UserId): Promise<boolean>;
}
export interface BillingAnalyticsPort {
  purchased(input: { readonly buyerId: UserId; readonly modelId: ModelId; readonly sellerId: UserId; readonly amount: number }): Promise<void>;
}

export interface BillingPurchase {
  readonly id: string;
  readonly model_id: string;
  readonly model_title: string;
  readonly price_minor: number;
  readonly currency: string;
  readonly status: string;
  readonly created_at: Date;
}
export interface BillingSale {
  readonly id: string;
  readonly model_id: string;
  readonly model_title: string;
  readonly seller_amount_minor: number;
  readonly currency: string;
  readonly created_at: Date;
  readonly paid_at: Date | null;
}
export interface BillingBalance {
  readonly availableMinor: number;
  readonly holdMinor: number;
  readonly currency: string;
}
export interface BillingPayout {
  readonly id: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly processedAt?: Date | null;
}
export type BillingWebhookResult = {
  readonly ok: true;
  readonly duplicate?: boolean;
  readonly matched?: boolean;
  readonly alreadyTerminal?: boolean;
  readonly ignoredStatus?: string;
};
export interface BillingPayoutInput {
  readonly amountMinor?: unknown;
  readonly requisites?: {
    readonly method?: unknown;
    readonly value?: unknown;
  } | null;
}

export interface BillingPort {
  createPurchase(
    userId: UserId,
    modelId: unknown,
  ): Promise<{
    readonly purchaseId: string;
    readonly confirmationUrl: string | null;
  }>;
  webhook(body: unknown): Promise<BillingWebhookResult>;
  purchases(userId: UserId): Promise<{ readonly purchases: readonly BillingPurchase[] }>;
  purchase(userId: UserId, id: string): Promise<{ readonly purchase: BillingPurchase }>;
  sales(userId: UserId): Promise<{ readonly sales: readonly BillingSale[] }>;
  balance(userId: UserId): Promise<BillingBalance>;
  createPayout(userId: UserId, body: BillingPayoutInput): Promise<BillingPayout>;
  payouts(userId: UserId): Promise<{ readonly payouts: readonly BillingPayout[] }>;
  transitionPayout(userId: UserId, id: string, status: unknown): Promise<{ readonly id: string; readonly status: "processing" | "paid" | "failed" }>;
}
export { BillingNotConfiguredError, createPayment, fetchPayment, isBillingConfigured, YookassaApiError } from "../infrastructure/yookassa-provider.ts";
