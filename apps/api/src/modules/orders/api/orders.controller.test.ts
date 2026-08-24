import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { OrdersController } from "./orders.controller.ts";

function route(name: keyof OrdersController) {
  const handler = OrdersController.prototype[name];
  if (typeof handler !== "function") throw new Error(String(name));
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? "",
  };
}

describe("OrdersController route inventory", () => {
  it("covers the three authoritative legacy routes", () => {
    expect([route("create"), route("get"), route("transition")]).toEqual([
      { method: RequestMethod.POST, path: "/" },
      { method: RequestMethod.GET, path: ":id" },
      { method: RequestMethod.PATCH, path: ":id/status" },
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, OrdersController)).toBe("orders");
  });
});
