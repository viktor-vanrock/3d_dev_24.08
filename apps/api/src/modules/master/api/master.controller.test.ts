import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { RequestMethod } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import routeManifest from "../../../characterization/routes.manifest.json" with { type: "json" };
import { MasterController } from "./master.controller.ts";

function routes(): string[] {
  const prototype = MasterController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(MasterController.prototype)
    .flatMap((name) => {
      const handler = prototype[name];
      if (typeof handler !== "function") return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) return [];
      return [`${["GET", "POST", "PUT", "DELETE", "PATCH", "ALL", "OPTIONS", "HEAD"][method]} /${path}`];
    })
    .sort();
}

describe("Nest master route migration", () => {
  it("implements exactly the four authoritative master routes", () => {
    const expected = routeManifest
      .filter((entry) => entry.domain === "master")
      .map((entry) => `${entry.method} ${entry.path}`)
      .sort();
    expect(expected).toHaveLength(4);
    expect(routes()).toEqual(expected);
  });
});
