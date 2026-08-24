import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { MakersController } from "./makers.controller.ts";

function route(name: keyof MakersController) {
  const handler = MakersController.prototype[name];
  if (typeof handler !== "function") throw new Error(String(name));
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? "",
  };
}

describe("MakersController route inventory", () => {
  it("maps all six authoritative legacy routes", () => {
    expect([route("feed"), route("follow"), route("unfollow"), route("profile"), route("updateProfile"), route("nearby")]).toEqual([
      { method: RequestMethod.GET, path: "makers/feed" },
      { method: RequestMethod.POST, path: "users/:username/follow" },
      { method: RequestMethod.DELETE, path: "users/:username/follow" },
      { method: RequestMethod.GET, path: "me/maker-profile" },
      { method: RequestMethod.PUT, path: "me/maker-profile" },
      { method: RequestMethod.GET, path: "makers/nearby" },
    ]);
  });
});
