import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { MakesController, ModelMakesController } from "./makes.controller.ts";

function routes(controller: object): string[] {
  const ctor = controller as { readonly prototype: object };
  const base = (Reflect.getMetadata(PATH_METADATA, ctor) as string | undefined) ?? "";
  return Object.getOwnPropertyNames(ctor.prototype).flatMap((name) => {
    const handler = Object.getOwnPropertyDescriptor(ctor.prototype, name)?.value as object | undefined;
    if (handler === undefined) return [];
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (path === undefined || method === undefined) return [];
    const suffix = path === "/" ? "" : `/${path}`;
    return [`${RequestMethod[method]} /${base}${suffix}`];
  });
}

describe("MakesController route inventory", () => {
  it("implements exactly the 12 characterized Makes routes", () => {
    expect([...routes(MakesController), ...routes(ModelMakesController)].sort()).toEqual(
      [
        "POST /makes/:id/repost",
        "POST /makes/:id/view",
        "POST /makes/:id/report",
        "GET /makes/:makeId/photos/:photoId",
        "GET /models/:id/makes/leaderboard",
        "POST /makes/:id/vote",
        "POST /makes",
        "GET /makes",
        "GET /makes/:id/comments",
        "POST /makes/:id/comments",
        "GET /makes/mine",
        "GET /makes/:id",
      ].sort(),
    );
  });

  it("preserves explicit mutation statuses and default create/comment 201", () => {
    expect(Reflect.getMetadata("__httpCode__", MakesController.prototype.repost)).toBe(200);
    expect(Reflect.getMetadata("__httpCode__", MakesController.prototype.view)).toBe(200);
    expect(Reflect.getMetadata("__httpCode__", MakesController.prototype.vote)).toBe(200);
    expect(Reflect.getMetadata("__httpCode__", MakesController.prototype.report)).toBe(202);
    expect(Reflect.getMetadata("__httpCode__", MakesController.prototype.create)).toBeUndefined();
    expect(Reflect.getMetadata("__httpCode__", MakesController.prototype.comment)).toBeUndefined();
  });
});
