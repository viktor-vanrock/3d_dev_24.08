import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { MarketplaceScreen } from "./market.tsx";
import type { MarketModel } from "./models.ts";

// Фильтр каталога «совместимо с моим парком» (MF-11, Фаза 3 MF-410): чип виден только когда
// у зрителя есть парк в ЛК (MF-15); включённый — отсекает модели с вердиктом 'blocked' у ВСЕХ
// принтеров парка (модель остаётся, если хотя бы один принтер даёт ok/warn).

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function model(id: string, title: string, priceMinor = 0): MarketModel {
  return {
    id,
    title,
    description: null,
    status: "ready",
    source_format: "stl",
    craft: "3d_printing",
    manufacturing_method: null,
    requires_ams: false,
    created_at: "2026-01-01T00:00:00Z",
    votes_up: 0,
    votes_down: 0,
    downloads_count: 0,
    price_minor: priceMinor,
    currency: "RUB",
    tags: [],
    thumb_url: null,
    owner: { id: "o1", username: "author" },
    project_summary: { file_count: 1, build_steps_count: 0 },
  };
}

const MODELS = [model("c1", "Совместимая модель"), model("b1", "Заблокированная модель", 15_000)];

function mockFetch({ printers = [] as Array<{ id: string; brand: string; model: string }> } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/me/activation")) {
        return new Response(
          JSON.stringify({
            activation: {
              state: "returning",
              has_printer: printers.length > 0,
              primary_persona: null,
              home_tier: "auto",
              activation_checklist: {},
              home_dismissed_prompts: { marketplace_experimental: true },
            },
            printers: printers.map((p) => ({ ...p, is_primary: true, verified: true })),
            filaments: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/me/printers/")) {
        const match = url.match(/\/me\/printers\/([^/]+)\/compat\?model_id=([^&]+)/);
        if (!match) return new Response(null, { status: 404 });
        const modelId = match[2];
        const verdict = modelId === "c1" ? "ok" : "blocked";
        const reasons =
          verdict === "blocked" ? [{ code: "geometry_exceeds_build_volume", severity: "blocked", message: "не влезает" }] : [];
        return new Response(JSON.stringify({ printer_id: match[1], material_id: null, model_id: modelId, verdict, reasons }), {
          status: 200,
        });
      }
      if (url.includes("/tags")) return new Response(JSON.stringify({ tags: [] }), { status: 200 });
      if (url.includes("/models")) {
        const models = url.includes("paid=1") ? MODELS.filter((item) => (item.price_minor ?? 0) > 0) : url.includes("paid=0") ? MODELS.filter((item) => (item.price_minor ?? 0) === 0) : MODELS;
        return new Response(JSON.stringify({ models, has_more: false, next_cursor: null }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderMarket() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <MarketplaceScreen user={user} section="market" onSectionChange={() => {}} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("MarketplaceScreen — фильтр «совместимо с моим парком»", () => {
  it("фильтрует каталог по платным моделям и показывает цену", async () => {
    const userEventSession = userEvent.setup();
    mockFetch();
    renderMarket();

    await screen.findByText("Совместимая модель");
    await userEventSession.click(screen.getByRole("button", { name: "Платно" }));

    await waitFor(() => expect(screen.queryByText("Совместимая модель")).toBeNull());
    expect(screen.getByText("Заблокированная модель")).toBeTruthy();
    expect(screen.getByText(/150.*₽/)).toBeTruthy();
  });
  it("без парка в ЛК чип фильтра не показывается", async () => {
    mockFetch({ printers: [] });
    renderMarket();

    await screen.findByText("Совместимая модель");
    expect(screen.queryByText("Совместимо с моим принтером")).toBeNull();
  });

  it("включение чипа отсекает модели с verdict=blocked, оставляя совместимые", async () => {
    const userEventSession = userEvent.setup();
    mockFetch({ printers: [{ id: "p1", brand: "Bambu Lab", model: "A1 mini" }] });
    renderMarket();

    await screen.findByText("Совместимая модель");
    expect(screen.getByText("Заблокированная модель")).toBeTruthy();

    await userEventSession.click(screen.getByRole("button", { name: "Совместимо с моим принтером" }));

    await waitFor(() => expect(screen.queryByText("Заблокированная модель")).toBeNull());
    expect(screen.getByText("Совместимая модель")).toBeTruthy();
  });

  it("«Сбросить фильтры» возвращает полный список", async () => {
    const userEventSession = userEvent.setup();
    mockFetch({ printers: [{ id: "p1", brand: "Bambu Lab", model: "A1 mini" }] });
    renderMarket();

    await screen.findByText("Совместимая модель");
    await userEventSession.click(screen.getByRole("button", { name: "Совместимо с моим принтером" }));
    await waitFor(() => expect(screen.queryByText("Заблокированная модель")).toBeNull());

    await userEventSession.click(screen.getByRole("button", { name: "Сбросить фильтры ✕" }));

    await waitFor(() => expect(screen.getByText("Заблокированная модель")).toBeTruthy());
  });
});
