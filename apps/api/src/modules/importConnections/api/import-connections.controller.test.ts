import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { ImportConnectionsController } from "./import-connections.controller.ts";

function route(name: keyof ImportConnectionsController) {
  const handler = ImportConnectionsController.prototype[name];
  if (typeof handler !== "function") throw new Error(String(name));
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? "",
  };
}

describe("ImportConnectionsController route inventory", () => {
  it("covers exactly the five singular import-connection routes", () => {
    expect([route("connect"), route("list"), route("listModels"), route("requestChallenge"), route("verifyChallenge")]).toEqual([
      { method: RequestMethod.POST, path: "/" },
      { method: RequestMethod.GET, path: "/" },
      { method: RequestMethod.GET, path: ":id/models" },
      { method: RequestMethod.POST, path: ":id/challenge" },
      { method: RequestMethod.POST, path: ":id/verify" },
    ]);
  });
});
