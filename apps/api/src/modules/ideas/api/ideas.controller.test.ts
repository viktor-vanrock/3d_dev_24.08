import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { IdeasController } from "./ideas.controller.ts";
import type { IdeasPort } from "../public/index.ts";

function route(methodName: keyof IdeasController): { readonly method: RequestMethod; readonly path: string } {
  const handler = IdeasController.prototype[methodName];
  if (typeof handler !== "function") throw new Error(`${String(methodName)} is not a controller method`);
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? "",
  };
}

describe("IdeasController route inventory", () => {
  it("covers every one of the 12 authoritative manifest routes", () => {
    expect([
      route("list"),
      route("mine"),
      route("top"),
      route("similar"),
      route("comments"),
      route("comment"),
      route("vote"),
      route("status"),
      route("moderate"),
      route("detail"),
      route("enrich"),
      route("create"),
    ]).toEqual([
      { method: RequestMethod.GET, path: "/" },
      { method: RequestMethod.GET, path: "mine" },
      { method: RequestMethod.GET, path: "top" },
      { method: RequestMethod.GET, path: "similar" },
      { method: RequestMethod.GET, path: ":id/comments" },
      { method: RequestMethod.POST, path: ":id/comments" },
      { method: RequestMethod.POST, path: ":id/vote" },
      { method: RequestMethod.PATCH, path: ":id/status" },
      { method: RequestMethod.POST, path: ":id/moderate" },
      { method: RequestMethod.GET, path: ":id" },
      { method: RequestMethod.POST, path: "enrich" },
      { method: RequestMethod.POST, path: "/" },
    ]);
  });

  it("keeps top cache behavior and create/comment default 201 behavior", () => {
    const port = { top: vi.fn() } as unknown as IdeasPort;
    const controller = new IdeasController(port);
    expect(controller).toBeDefined();
    const top = IdeasController.prototype.top;
    expect(Reflect.getMetadata("__headers__", top)).toEqual([{ name: "Cache-Control", value: "private, max-age=300" }]);
    expect(Reflect.getMetadata("__httpCode__", IdeasController.prototype.create)).toBeUndefined();
    expect(Reflect.getMetadata("__httpCode__", IdeasController.prototype.comment)).toBeUndefined();
  });
});
