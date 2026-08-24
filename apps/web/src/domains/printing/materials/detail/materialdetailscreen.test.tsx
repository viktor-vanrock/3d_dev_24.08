import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@platform/theme";
import { OverlayProvider } from "@platform/overlay";
import { MaterialDetailScreen } from "./materialdetailscreen.tsx";

const material = {
  id: "material-1",
  craft: "3d_print",
  kind: "filament" as const,
  slug: "pla-basic",
  name: "PLA Basic",
  vendor: { id: "vendor-1", slug: "prusament", name: "Prusament" },
  material_type: { id: "type-1", slug: "pla", name: "PLA" },
  variants: [
    { id: "variant-1", color_name: "Чёрный", color_hex: "#111111", diameter_mm: 1.75, weight_g: 1000, spool_type: "картонная катушка", sku: "PLA-BLK", created_at: "2026-07-01T00:00:00Z" },
    { id: "variant-2", color_name: "Без цвета", color_hex: "not-a-color", diameter_mm: 1.75, weight_g: null, spool_type: null, sku: null, created_at: "2026-07-01T00:00:00Z" },
  ],
  make_stats: { make_count: 1, model_count: 1 },
};

const firstMake = {
  id: "make-1",
  created_at: "2026-07-02T00:00:00Z",
  caption: "Чистые стенки",
  printability_rating: 5,
  model: { id: "model-1", title: "Органайзер" },
  user: { id: "user-1", username: "maker", display_name: null },
};

function renderDetail() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <MaterialDetailScreen user={null} section="market" onSectionChange={() => {}} id="material-1" />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("MaterialDetailScreen (MF-346.5)", () => {
  it("резервирует toast-safe слот для detail и 404, не меняя shell без toast", () => {
    const css = readFileSync(resolve(process.cwd(), "src/domains/printing/materials/detail/materialdetail.css"), "utf8");

    expect(css).toMatch(
      /body:has\(\.materialDetailPage\):has\(\.ovlToast\) \.materialDetailContent\s*\{[\s\S]*?padding-top:\s*calc\(var\(--header-safe\) \+ 88px\);/,
    );
  });

  it("при cold-start возвращает в каталог с query вместо about:blank", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ material, makes: [], makes_has_more: false })));
    // happy-dom не позволяет создать cross-origin about:blank через pushState;
    // корень сайта здесь представляет стартовую запись fresh browser context.
    window.history.replaceState(null, "", "/");
    window.history.pushState(null, "", "/materials/material-1?q=ABS");

    renderDetail();

    expect(await screen.findByRole("heading", { name: "PLA Basic", level: 1 })).toBeTruthy();
    const backButton = screen.getByRole("button", { name: "Назад к материалам" });
    expect(backButton.classList.contains("uiIconButton")).toBe(true);
    fireEvent.click(backButton);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/materials");
      expect(window.location.search).toBe("?q=ABS");
    });
  });

  it("открывается по прямой ссылке и возвращает query каталога", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => response({ material, makes: [], makes_has_more: false }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/materials?q=PLA&kind=filament");
    window.history.pushState(null, "", "/materials/material-1?q=PLA&kind=filament");

    renderDetail();

    expect(await screen.findByRole("heading", { name: "PLA Basic", level: 1 })).toBeTruthy();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/materials/material-1?limit=6&offset=0");
    fireEvent.click(screen.getByRole("button", { name: "Назад к материалам" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/materials");
      expect(window.location.search).toBe("?q=PLA&kind=filament");
    });
  });

  it("показывает identity, варианты и печати, не маскируя невалидный цвет", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ material, makes: [firstMake], makes_has_more: false })));

    renderDetail();

    expect(await screen.findByRole("heading", { name: "PLA Basic", level: 1 })).toBeTruthy();
    expect(screen.getByText("Prusament")).toBeTruthy();
    expect(screen.getByText("PLA · Филамент")).toBeTruthy();
    expect(screen.getByText(/картонная катушка/)).toBeTruthy();
    expect(screen.getByText(/SKU PLA-BLK/)).toBeTruthy();
    expect(screen.getByText("Чистые стенки")).toBeTruthy();
    expect(screen.getByText("Оценка печати: 5/5")).toBeTruthy();
    expect(screen.getByText("Без цвета")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Примеры печати · 1", level: 2 })).toBeTruthy();
  });

  it("для 404 показывает честное состояние и ссылку возврата", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "not_found" }, 404)));

    renderDetail();

    expect((await screen.findByRole("alert")).textContent).toContain("Такого материала у нас пока нет");
    expect(screen.getByRole("button", { name: "Назад к материалам" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "К материалам" })).toHaveLength(1);
  });

  it("для 401 оставляет карточку на месте и предлагает вход", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: "unauthorized" }, 401)));
    window.history.replaceState(null, "", "/materials/material-1?q=pla");

    renderDetail();

    expect((await screen.findByRole("alert")).textContent).toContain("Войдите, чтобы открыть материал");
    expect(screen.getAllByRole("button", { name: "Войти" })).toHaveLength(2);
    expect(window.location.pathname).toBe("/materials/material-1");
    expect(window.location.search).toBe("?q=pla");
  });

  it("ошибка сети предлагает повторить запрос", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(response({ material, makes: [], makes_has_more: false }));
    vi.stubGlobal("fetch", fetchMock);

    renderDetail();

    expect((await screen.findByRole("alert")).textContent).toContain("Не удалось загрузить материал");
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("heading", { name: "PLA Basic", level: 1 })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("догружает печати, оставляя уже показанные строки", async () => {
    const secondMake = { ...firstMake, id: "make-2", caption: "Надёжный первый слой" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ material, makes: [firstMake], makes_has_more: true }))
      .mockResolvedValueOnce(response({ material, makes: [secondMake], makes_has_more: false }));
    vi.stubGlobal("fetch", fetchMock);

    renderDetail();
    expect(await screen.findByText("Чистые стенки")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));
    expect(await screen.findByText("Надёжный первый слой")).toBeTruthy();
    expect(screen.getByText("Чистые стенки")).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[0]).toContain("offset=1");
  });
});
