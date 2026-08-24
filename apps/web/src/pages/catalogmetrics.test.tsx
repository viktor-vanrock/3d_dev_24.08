import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CatalogMetricsPage } from "./catalogmetrics.tsx";

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.keys(routes).find((key) => url.includes(key));
      if (!match) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(routes[match]), { status: 200 });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CatalogMetricsPage", () => {
  it("показывает 4 метрики с бэкенда", async () => {
    mockFetch({
      "/catalog/metrics": {
        total_models: 42,
        complete_specs_pct: 71.5,
        verified_pct: 33.3,
        median_freshness_days: 12.4,
      },
    });
    render(<CatalogMetricsPage />);
    expect(await screen.findByText("42")).toBeTruthy();
    expect(screen.getByText("71.5%")).toBeTruthy();
    expect(screen.getByText("33.3%")).toBeTruthy();
    expect(screen.getByText("12.4")).toBeTruthy();
  });

  it("median_freshness_days: null (пустой каталог) → прочерк, без падения", async () => {
    mockFetch({
      "/catalog/metrics": { total_models: 0, complete_specs_pct: 0, verified_pct: 0, median_freshness_days: null },
    });
    render(<CatalogMetricsPage />);
    expect(await screen.findByText("—")).toBeTruthy();
  });

  it("ошибка запроса → сообщение вместо плиток", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    render(<CatalogMetricsPage />);
    expect(await screen.findByText(/Не удалось загрузить метрики/)).toBeTruthy();
  });
});
