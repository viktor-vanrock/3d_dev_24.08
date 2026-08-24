import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { ImportsController } from "./imports.controller.ts";

function route(methodName: keyof ImportsController) {
  const handler = ImportsController.prototype[methodName];
  if (typeof handler !== "function") throw new Error(`${String(methodName)} is not a controller method`);
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? "",
  };
}

describe("ImportsController route inventory", () => {
  it("covers all three authoritative import-job routes", () => {
    expect([route("enqueue"), route("list"), route("detail")]).toEqual([
      { method: RequestMethod.POST, path: "/" },
      { method: RequestMethod.GET, path: "/" },
      { method: RequestMethod.GET, path: ":id" },
    ]);
  });
});
