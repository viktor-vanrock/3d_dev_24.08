import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import routeManifest from "./routes.manifest.json" with { type: "json" };
import { createNestApp } from "../nest/bootstrap.ts";
import { createOpenApiDocument } from "../nest/openapi/setup-openapi.ts";
import { FORMALLY_REMOVED_ROUTES } from "./formallyRemovedRoutes.ts";

const HTTP_METHODS = new Set(["delete", "get", "head", "options", "patch", "post", "put"]);

function normalizePath(path: string): string {
  if (path === "/research/media/*") return "/research/media/{key}";
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

describe("Nest route inventory coverage", () => {
  let app: INestApplication;
  let nestRoutes: Set<string>;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "nest-route-coverage-test-secret";
    app = await createNestApp();
    await app.init();

    nestRoutes = new Set<string>();
    const document = createOpenApiDocument(app);
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of Object.keys(item ?? {})) {
        if (HTTP_METHODS.has(method)) nestRoutes.add(`${method.toUpperCase()} ${normalizePath(path)}`);
      }
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it("accounts for all 308 baseline routes: 261 migrated and 47 formally removed", () => {
    const baseline = routeManifest.map((route) => `${route.method} ${normalizePath(route.path)}`);
    const migrated = baseline.filter((route) => nestRoutes.has(route));
    const linkedChange = routeManifest.filter((route) => FORMALLY_REMOVED_ROUTES.has(`${route.method} ${route.path}`));
    const unaccounted = routeManifest.filter((route) => {
      const normalized = `${route.method} ${normalizePath(route.path)}`;
      return !nestRoutes.has(normalized) && !FORMALLY_REMOVED_ROUTES.has(`${route.method} ${route.path}`);
    });

    expect(baseline).toHaveLength(308);
    expect(migrated).toHaveLength(261);
    expect(linkedChange).toHaveLength(47);
    expect(unaccounted).toEqual([]);
  });
});
