import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProductHealthPage } from "./producthealth.tsx";

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

describe("ProductHealthPage", () => {
  it("показывает три блока с бэкенда", async () => {
    mockFetch({
      "/analytics/health": {
        funnel: { window_days: 30, signups: 12, activated: 4, downloaded: 2, activation_pct: 40, download_pct: 20 },
        activity: { dau: 5, wau: 8, mau: 10, stickiness_pct: 50 },
        marketplace: {
          published_models_30d: 3,
          published_models_30d_with_download: 1,
          liquidity_rate: 0.3333,
          searches_30d: 4,
          searches_with_download_30d: 1,
          search_to_download_match_rate: 0.25,
        },
      },
    });
    render(<ProductHealthPage />);
    expect(await screen.findByText("12")).toBeTruthy();
    expect(screen.getByText("4 (40%)")).toBeTruthy();
    expect(screen.getByText("2 (20%)")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("33.3%")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("liquidity_rate null (пустой каталог) → прочерк, без падения", async () => {
    mockFetch({
      "/analytics/health": {
        funnel: { window_days: 30, signups: 0, activated: 0, downloaded: 0, activation_pct: 0, download_pct: 0 },
        activity: { dau: 0, wau: 0, mau: 0, stickiness_pct: 0 },
        marketplace: {
          published_models_30d: 0,
          published_models_30d_with_download: 0,
          liquidity_rate: null,
          searches_30d: 0,
          searches_with_download_30d: 0,
          search_to_download_match_rate: null,
        },
      },
    });
    render(<ProductHealthPage />);
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBe(2);
  });

  it("ошибка запроса → сообщение вместо плиток", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    render(<ProductHealthPage />);
    expect(await screen.findByText(/Не удалось загрузить метрики/)).toBeTruthy();
  });
});
