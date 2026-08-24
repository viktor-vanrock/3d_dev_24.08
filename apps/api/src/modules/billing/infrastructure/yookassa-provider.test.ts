import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingNotConfiguredError, YookassaApiError, createPayment, fetchPayment, isBillingConfigured } from "./yookassa-provider.ts";

const ORIGINAL_ENV = { ...process.env };

describe("billing/provider (ЮKassa)", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("isBillingConfigured is false without shopId/secretKey", () => {
    delete process.env.YOOKASSA_SHOP_ID;
    delete process.env.YOOKASSA_SECRET_KEY;
    expect(isBillingConfigured()).toBe(false);
  });

  it("isBillingConfigured is true with both env vars set", () => {
    process.env.YOOKASSA_SHOP_ID = "shop-1";
    process.env.YOOKASSA_SECRET_KEY = "secret-1";
    expect(isBillingConfigured()).toBe(true);
  });

  describe("without configuration", () => {
    beforeEach(() => {
      delete process.env.YOOKASSA_SHOP_ID;
      delete process.env.YOOKASSA_SECRET_KEY;
    });

    it("createPayment throws BillingNotConfiguredError", async () => {
      await expect(
        createPayment({
          amountMinor: 10000,
          currency: "RUB",
          description: "тест",
          returnUrl: "https://3mf.tech/purchases/1",
          idempotenceKey: "key-1",
          metadata: {},
        }),
      ).rejects.toBeInstanceOf(BillingNotConfiguredError);
    });

    it("fetchPayment throws BillingNotConfiguredError", async () => {
      await expect(fetchPayment("payment-1")).rejects.toBeInstanceOf(BillingNotConfiguredError);
    });
  });

  describe("with configuration", () => {
    beforeEach(() => {
      process.env.YOOKASSA_SHOP_ID = "shop-1";
      process.env.YOOKASSA_SECRET_KEY = "secret-1";
    });

    it("createPayment posts amount in major units and returns confirmationUrl", async () => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("https://api.yookassa.ru/v3/payments");
        expect(init?.headers).toMatchObject({ "Idempotence-Key": "key-1" });
        const body = JSON.parse(String(init?.body));
        expect(body.amount).toEqual({ value: "150.00", currency: "RUB" });
        return new Response(
          JSON.stringify({
            id: "pay-1",
            status: "pending",
            paid: false,
            confirmation: { confirmation_url: "https://yookassa.ru/checkout/pay-1" },
          }),
          { status: 200 },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await createPayment({
        amountMinor: 15000,
        currency: "RUB",
        description: "Покупка модели",
        returnUrl: "https://3mf.tech/purchases/1",
        idempotenceKey: "key-1",
        metadata: { purchase_id: "1" },
      });

      expect(result).toEqual({
        id: "pay-1",
        status: "pending",
        paid: false,
        confirmationUrl: "https://yookassa.ru/checkout/pay-1",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("createPayment throws YookassaApiError on non-ok response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ description: "invalid" }), { status: 400 })),
      );

      await expect(
        createPayment({
          amountMinor: 100,
          currency: "RUB",
          description: "тест",
          returnUrl: "https://3mf.tech/purchases/1",
          idempotenceKey: "key-2",
          metadata: {},
        }),
      ).rejects.toBeInstanceOf(YookassaApiError);
    });

    it("fetchPayment returns parsed payment status", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          expect(url).toBe("https://api.yookassa.ru/v3/payments/pay-1");
          return new Response(JSON.stringify({ id: "pay-1", status: "succeeded", paid: true }), { status: 200 });
        }),
      );

      const result = await fetchPayment("pay-1");
      expect(result).toEqual({ id: "pay-1", status: "succeeded", paid: true, confirmationUrl: null });
    });

    it("fetchPayment throws YookassaApiError on non-ok response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({}), { status: 404 })),
      );
      await expect(fetchPayment("missing")).rejects.toBeInstanceOf(YookassaApiError);
    });
  });
});
