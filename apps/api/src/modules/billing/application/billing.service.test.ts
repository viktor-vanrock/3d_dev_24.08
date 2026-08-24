import { describe, expect, it, vi } from "vitest";
import { ModelId, UserId } from "../../_kernel/brandedIds.ts";
import type { BillingRepository } from "../infrastructure/billing.repository.ts";
import { BillingService } from "./billing.service.ts";
import type { BillingAnalyticsPort, BillingModelReadPort, BillingProviderPort, BillingStaffPort } from "../public/index.ts";
function stub<T>(value: Partial<T>): T {
  return value as T;
}
describe("BillingService parity", () => {
  it("creates the legacy provider request and response shape", async () => {
    const buyer = UserId("11111111-1111-4111-8111-111111111111"),
      seller = UserId("22222222-2222-4222-8222-222222222222"),
      modelId = ModelId("33333333-3333-4333-8333-333333333333");
    const createPurchase = vi.fn().mockResolvedValue("44444444-4444-4444-8444-444444444444"),
      setPurchaseProvider = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: "pay-1", confirmationUrl: "https://pay" });
    const service = new BillingService(
      stub<BillingRepository>({
        alreadyPurchased: vi.fn().mockResolvedValue(false),
        createPurchase,
        setPurchaseProvider,
      }),
      stub<BillingModelReadPort>({
        findMany: vi.fn().mockResolvedValue(
          new Map([
            [
              modelId,
              {
                id: modelId,
                ownerId: seller,
                title: "M",
                priceMinor: 15000,
                currency: "RUB",
                publishStatus: "published",
              },
            ],
          ]),
        ),
      }),
      stub<BillingProviderPort>({ configured: () => true, create }),
      stub<BillingStaffPort>({}),
      stub<BillingAnalyticsPort>({}),
    );
    await expect(service.createPurchase(buyer, modelId)).resolves.toEqual({
      purchaseId: "44444444-4444-4444-8444-444444444444",
      confirmationUrl: "https://pay",
    });
    expect(createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        platformFeeMinor: 3000,
        sellerAmountMinor: 12000,
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotenceKey: "44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(setPurchaseProvider).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444", "pay-1");
  });
  it("preserves the documented webhook dedupe-before-verification defect", async () => {
    const insertWebhook = vi.fn().mockResolvedValue("event-row"),
      fetch = vi.fn().mockRejectedValue(new Error("transient"));
    const service = new BillingService(
      stub<BillingRepository>({
        insertWebhook,
        providerPurchase: vi.fn().mockResolvedValue({ id: "p", status: "pending" }),
        linkWebhook: vi.fn(),
      }),
      stub<BillingModelReadPort>({}),
      stub<BillingProviderPort>({ fetch }),
      stub<BillingStaffPort>({}),
      stub<BillingAnalyticsPort>({}),
    );
    await expect(service.webhook({ event: "payment.succeeded", object: { id: "pay" } })).rejects.toMatchObject({ status: 502 });
    expect(insertWebhook).toHaveBeenCalledBefore(fetch);
  });
  it("keeps insufficient payout as 422", async () => {
    const service = new BillingService(
      stub<BillingRepository>({
        requestPayout: vi.fn().mockResolvedValue({ kind: "insufficient" }),
      }),
      stub<BillingModelReadPort>({}),
      stub<BillingProviderPort>({}),
      stub<BillingStaffPort>({}),
      stub<BillingAnalyticsPort>({}),
    );
    await expect(
      service.createPayout(UserId("11111111-1111-4111-8111-111111111111"), {
        amountMinor: 100,
        requisites: { method: "card", value: "1" },
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
