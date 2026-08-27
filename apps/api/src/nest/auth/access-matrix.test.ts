import { describe, expect, it } from "vitest";
import routeManifest from "../../characterization/routes.manifest.json" with { type: "json" };
import { FORMALLY_REMOVED_ROUTES } from "../../characterization/formallyRemovedRoutes.ts";
import { requiresSession } from "./access-matrix.ts";

type AuthMode = "authed" | "open" | "open-own-gate" | "public-GET" | "public-GET-always" | "open-exact-POST";

interface RouteEntry {
  readonly method: string;
  readonly path: string;
  readonly authMode: AuthMode;
  readonly closedDevAuthed: boolean;
  readonly sampleParams: Readonly<Record<string, string>>;
}

const routes = routeManifest as unknown as RouteEntry[];
const activeRoutes = routes.filter((route) => !FORMALLY_REMOVED_ROUTES.has(`${route.method} ${route.path}`));

function concreteUrl(route: RouteEntry): string {
  let url = route.path;
  for (const [key, value] of Object.entries(route.sampleParams)) {
    url = key === "*" ? url.replace(/\*/, value) : url.replace(new RegExp(`:${key}(?![A-Za-z0-9_])`, "g"), value);
  }
  return url;
}

describe("Nest auth access matrix", () => {
  it("matches normal-mode decisions for every active route in the immutable manifest", () => {
    expect(routes).toHaveLength(315);
    expect(activeRoutes).toHaveLength(268);
    for (const route of activeRoutes) {
      expect(requiresSession({ method: route.method, url: concreteUrl(route), closedDev: false }), `${route.method} ${route.path}`).toBe(route.authMode === "authed");
    }
  });

  it("matches CLOSED_DEV decisions for every active route in the immutable manifest", () => {
    for (const route of activeRoutes) {
      expect(requiresSession({ method: route.method, url: concreteUrl(route), closedDev: true }), `${route.method} ${route.path}`).toBe(
        route.authMode === "authed" || route.closedDevAuthed,
      );
    }
  });

  it("keeps strict UUID literals from opening sibling idea routes", () => {
    expect(requiresSession({ method: "GET", url: "/ideas/similar", closedDev: false })).toBe(true);
    expect(
      requiresSession({
        method: "GET",
        url: "/ideas/11111111-1111-4111-8111-111111111111",
        closedDev: false,
      }),
    ).toBe(false);
  });

  it("delegates relay v1 authentication to the relay-only service guard", () => {
    expect(requiresSession({ method: "POST", url: "/internal/relay/v1/sessions/authorize", closedDev: false })).toBe(false);
    expect(requiresSession({ method: "POST", url: "/internal/relay/v1/sessions/authorize", closedDev: true })).toBe(false);
  });

  it("opens only the exact metrics endpoint for its loopback controller gate", () => {
    expect(requiresSession({ method: "GET", url: "/metrics", closedDev: false })).toBe(false);
    expect(requiresSession({ method: "GET", url: "/metrics", closedDev: true })).toBe(false);
    expect(requiresSession({ method: "GET", url: "/metrics/private", closedDev: false })).toBe(true);
  });
});
