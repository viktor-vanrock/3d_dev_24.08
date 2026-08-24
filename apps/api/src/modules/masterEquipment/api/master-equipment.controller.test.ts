import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { MasterEquipmentController } from "./master-equipment.controller.ts";

function route(name: keyof MasterEquipmentController) {
  const handler = MasterEquipmentController.prototype[name];
  if (typeof handler !== "function") throw new Error(String(name));
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: Reflect.getMetadata(PATH_METADATA, handler) as string,
  };
}

describe("MasterEquipmentController route inventory", () => {
  it("maps all four authoritative routes", () => {
    expect([route("create"), route("update"), route("delete"), route("list")]).toEqual([
      { method: RequestMethod.POST, path: "master-equipment" },
      { method: RequestMethod.PATCH, path: "master-equipment/:id" },
      { method: RequestMethod.DELETE, path: "master-equipment/:id" },
      { method: RequestMethod.GET, path: "masters/:masterId/equipment" },
    ]);
  });
});
