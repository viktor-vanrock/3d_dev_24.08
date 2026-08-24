import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isApiErrorEnvelope } from "@portal/contracts/http/error-envelope";
import routeManifest from "./routes.manifest.json" with { type: "json" };
import { FORMALLY_REMOVED_ROUTES } from "./formallyRemovedRoutes.ts";

// Live Nest auth-gate regression (backend-nest-migration task 5.1, spec api-runtime →
// «Auth deny сохраняет решение и status, но получает versioned body»).
//
// HISTORY: до cutover (task 7.4) этот тест был ДИФФЕРЕНЦИАЛЬНЫМ — поднимал ОБА рантайма (live Fastify
// `buildServer` + live Nest `createNestApp`) и реплеил один и тот же unauthenticated-запрос против
// каждого, доказывая идентичность allow/deny-решения и HTTP-status при единственном санкционированном
// расхождении в теле (legacy `{error:"unauthorized"}` → versioned `auth.unauthorized.v1`). На cutover
// Fastify удалён (задача 7.4), диффать больше не с чем — тест редуцирован до Nest-only: он остаётся
// live-HTTP характеризацией auth-гейта по всем 300 мигрированным маршрутам (дополняет чистофункциональный
// `nest/auth/access-matrix.test.ts`, который проверяет `requiresSession` без реального стека).
//
// DB-independent by construction: глобальный Nest `AuthGuard` решает block-vs-pass ДО хендлера. Маршруты,
// прошедшие гейт, доходят до реального хендлера, который без Postgres может 500 или зависнуть — для них
// проверяется РЕШЕНИЕ гейта («не заблокирован глобально»), а не тело/200 хендлера.

type AuthMode = "authed" | "open" | "open-own-gate" | "public-GET" | "public-GET-always" | "open-exact-POST";

interface RouteEntry {
  readonly method: string;
  readonly path: string;
  readonly domain: string;
  readonly authMode: AuthMode;
  readonly closedDevAuthed: boolean;
  readonly ownGate: string | null;
  readonly source: string;
  readonly sampleParams: Readonly<Record<string, string>>;
}

const routes = routeManifest as unknown as RouteEntry[];

// Nest owns 261 of the 308 historical routes. Relay routes and the deliberately removed legacy
// Model product surface remain accounted for by the coverage/ledger gate, but are not replayed.
const migratedRoutes = routes.filter((r) => !FORMALLY_REMOVED_ROUTES.has(`${r.method} ${r.path}`));

function concreteUrl(route: RouteEntry): string {
  let url = route.path;
  for (const [key, value] of Object.entries(route.sampleParams)) {
    url = key === "*" ? url.replace(/\*/, value) : url.replace(new RegExp(`:${key}(?![A-Za-z0-9_])`, "g"), value);
  }
  return url;
}

function hasBody(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH";
}

interface Probe {
  readonly status: number;
  readonly body: unknown;
}

// Nest global block: 401 + versioned envelope with the auth code (legacy body intentionally replaced,
// operator decision 2026-08-05 / design.md §4).
function isNestGlobalBlock(probe: Probe): boolean {
  return probe.status === 401 && isApiErrorEnvelope(probe.body) && probe.body.error.code === "auth.unauthorized.v1";
}

// A passing route reaches its real handler, which without a DB/upstream may hang (e.g. an OAuth
// callback attempting a live redirect fetch). The gate decision has already been made by then, so a
// handler that doesn't answer within the budget is, by definition, "not globally blocked" — we
// surface that as a sentinel `HANDLER_TIMEOUT` status rather than failing the assertion.
const HANDLER_TIMEOUT = 0 as const;
const NEST_PROBE_TIMEOUT_MS = 2500;

async function probeNest(baseUrl: string, route: RouteEntry): Promise<Probe & { requestId: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEST_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${concreteUrl(route)}`, {
      method: route.method.toUpperCase(),
      signal: controller.signal,
      ...(hasBody(route.method) ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body, requestId: res.headers.get("x-request-id") };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: HANDLER_TIMEOUT, body: null, requestId: null };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

describe("live Nest auth-gate regression (task 5.1, Nest-only after cutover 7.4)", () => {
  let nest: INestApplication;
  let nestBaseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "differential-regression-test-secret";
    delete process.env.CLOSED_DEV;
    vi.resetModules();

    const { createNestApp } = await import("../nest/bootstrap.ts");
    nest = await createNestApp();
    await nest.init();
    await nest.listen(0, "127.0.0.1");
    const address = (nest.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("Nest server did not bind");
    nestBaseUrl = `http://127.0.0.1:${address.port}`;
  }, 60000);

  afterAll(async () => {
    await nest?.close();
    delete process.env.JWT_SECRET;
  });

  it("replays the migrated subset of the baseline (261 of 308; 47 formally removed)", () => {
    expect(routes).toHaveLength(308);
    expect(migratedRoutes).toHaveLength(261);
  });

  const authed = migratedRoutes.filter((r) => r.authMode === "authed");
  const pureOpen = migratedRoutes.filter((r) => r.authMode === "open" || r.authMode === "public-GET" || r.authMode === "public-GET-always");
  const ownGated = migratedRoutes.filter((r) => r.authMode === "open-own-gate" || r.authMode === "open-exact-POST");

  // Every authed route: Nest DENIES with 401 + versioned envelope, and envelope.requestId echoes the
  // x-request-id response header (the correlation contract, design.md §4).
  describe(`authed routes: 401 versioned envelope + requestId echo (${authed.length})`, () => {
    it.each(authed.map((r) => [`${r.method} ${r.path}`, r] as const))("%s → 401 auth.unauthorized.v1 with correlated requestId", async (_label, route) => {
      const nestProbe = await probeNest(nestBaseUrl, route);
      expect(nestProbe.status).toBe(401);
      expect(isNestGlobalBlock(nestProbe)).toBe(true);
      expect(nestProbe.body).not.toEqual({ error: "unauthorized" });
      expect(nestProbe.requestId).toMatch(/^[0-9a-f-]{36}$/i);
      if (isApiErrorEnvelope(nestProbe.body)) {
        expect(nestProbe.body.error.requestId).toBe(nestProbe.requestId);
      }
    });
  });

  // Pure open + public-GET routes: Nest does NOT return the global session block (gate passes; behavior
  // past the gate is out of scope — may 2xx/404/422/500-no-DB).
  describe(`open / public-GET routes: not globally blocked (${pureOpen.length})`, () => {
    it.each(pureOpen.map((r) => [`${r.method} ${r.path}`, r] as const))("%s → not the global session block", async (_label, route) => {
      const nestProbe = await probeNest(nestBaseUrl, route);
      expect(isNestGlobalBlock(nestProbe)).toBe(false);
    });
  });

  // Own-gate + exact-open POST routes: bypass the GLOBAL session gate but enforce their own credential,
  // so an unauthenticated probe must yield "no 2xx" (>=400 or the handler-timeout sentinel, which is by
  // definition not a success).
  describe(`own-gate routes: no unauthenticated 2xx (${ownGated.length})`, () => {
    it.each(ownGated.map((r) => [`${r.method} ${r.path}`, r] as const))("%s → rejects unauthenticated success", async (_label, route) => {
      const nestProbe = await probeNest(nestBaseUrl, route);
      expect(nestProbe.status === HANDLER_TIMEOUT || nestProbe.status >= 400).toBe(true);
    });
  });
});
