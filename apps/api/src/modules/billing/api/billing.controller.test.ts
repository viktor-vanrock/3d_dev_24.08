import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { BillingController } from "./billing.controller.ts";
function route(name: keyof BillingController) {
  const fn = BillingController.prototype[name];
  if (typeof fn !== "function") throw new Error(String(name));
  return {
    method: Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod,
    path: (Reflect.getMetadata(PATH_METADATA, fn) as string | undefined) ?? "",
  };
}
describe("BillingController route inventory", () => {
  it("covers all nine authoritative billing routes", () => {
    expect([
      route("purchaseCreate"),
      route("webhook"),
      route("purchases"),
      route("purchase"),
      route("sales"),
      route("balance"),
      route("payoutCreate"),
      route("payouts"),
      route("payoutTransition"),
    ]).toEqual([
      { method: RequestMethod.POST, path: "purchases" },
      { method: RequestMethod.POST, path: "billing/webhooks/yookassa" },
      { method: RequestMethod.GET, path: "purchases" },
      { method: RequestMethod.GET, path: "purchases/:id" },
      { method: RequestMethod.GET, path: "sales" },
      { method: RequestMethod.GET, path: "me/balance" },
      { method: RequestMethod.POST, path: "payouts" },
      { method: RequestMethod.GET, path: "payouts" },
      { method: RequestMethod.PATCH, path: "payouts/:id" },
    ]);
  });
});
