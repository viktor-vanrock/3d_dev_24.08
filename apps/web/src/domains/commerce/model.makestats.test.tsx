import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { ModelScreen } from "./model.tsx";

// Вкладка «Напечатали» карточки модели (MF-395 п.3/MF-779): агрегаты совместимости
// (model_make_stats/model_printer_material_combo_stats через GET /models/:id) вместо заглушки,
// как только у модели есть хотя бы один опубликованный Make.

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function baseModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Тестовая модель",
    description: null,
    status: "ready",
    publish_status: "published",
    source_format: "stl",
    craft: "3d_printing",
    created_at: "2026-07-01T00:00:00Z",
    votes_up: 0,
    votes_down: 0,
    downloads_count: 0,
    tags: [],
    thumb_url: null,
    bbox: null,
    size_bytes: null,
    my_vote: 0,
    preview_url: null,
    preview_mobile_url: null,
    download_url: null,
    files: [],
    repo_url: null,
    recommended_material: null,
    owner: { id: "u1", username: "tester", display_name: null, avatar_url: null },
    make_stats: { makes_count: 0, machines_count: 0, materials_count: 0, avg_printability_rating: null },
    top_combos: [],
    ...overrides,
  };
}

function mockFetch(model: ReturnType<typeof baseModel>, leaderboardItems: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/makes/leaderboard")) return new Response(JSON.stringify({ items: leaderboardItems }), { status: 200 });
      if (url.includes("/models/m1")) return new Response(JSON.stringify({ model }), { status: 200 });
      return new Response(null, { status: 404 });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderModel() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <ModelScreen user={user} section="market" onSectionChange={() => {}} id="m1" tab="makes" />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("ModelScreen — вкладка «Напечатали»", () => {
  it("без Make приглашает показать первый живой результат, не рисует агрегаты", async () => {
    mockFetch(baseModel());
    renderModel();
    expect(await screen.findByText("Станьте первым, кто покажет результат")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Я сделал этот проект" })).toBeTruthy();
    expect(screen.queryByText("Напечатано раз")).toBeFalsy();
  });

  it("с Make показывает счётчики станков/филаментов, среднюю оценку и топ-связку", async () => {
    mockFetch(
      baseModel({
        make_stats: {
          makes_count: 5,
          machines_count: 2,
          materials_count: 3,
          avg_printability_rating: 4.2,
          avg_geometry_quality_rating: 4,
          avg_surface_quality_rating: 3.5,
        },
        top_combos: [{ machine: { id: "mc1", model: "Bambu X1C" }, material: { id: "mt1", name: "PLA Basic" }, combo_count: 3 }],
      }),
    );
    renderModel();

    fireEvent.click(await screen.findByText("Напечатали"));

    const countTiles = within((await screen.findByText("Напечатано раз")).closest(".uiStatTileGrid") as HTMLElement);
    expect(countTiles.getByText("5")).toBeTruthy();
    expect(countTiles.getByText("2")).toBeTruthy();
    expect(countTiles.getByText("3")).toBeTruthy();

    // MF-1962: печатаемость/геометрия (качество проекта) и поверхность (качество результата) —
    // раздельные плитки, не одно смешанное среднее.
    const projectTiles = within((await screen.findByText("Печатабельность")).closest(".uiStatTileGrid") as HTMLElement);
    expect(projectTiles.getByText("4.2")).toBeTruthy();
    expect(projectTiles.getByText("Геометрия и стыки")).toBeTruthy();
    expect(projectTiles.getByText("4.0")).toBeTruthy();

    const resultTiles = within((await screen.findByText("Поверхность отпечатков")).closest(".uiStatTileGrid") as HTMLElement);
    expect(resultTiles.getByText("3.5")).toBeTruthy();

    expect(screen.getByText("Bambu X1C × PLA Basic")).toBeTruthy();
  });

  it("под агрегатами показывает лидерборд лучших печатей с персонажем автора (MF-1031)", async () => {
    mockFetch(
      baseModel({ make_stats: { makes_count: 2, machines_count: 1, materials_count: 1, avg_printability_rating: 5 } }),
      [
        {
          id: "mk1",
          user_id: "u2",
          username: "maker42",
          display_name: null,
          avatar_url: null,
          avatar_config: { color: "mint", texture: "layers", pose: "stand", outfit: "none", hat: "none", eyes: "dots", beard: "none", arms: "plain", accessory: "none", back: "none" },
          avatar_snapshots: null,
          caption: null,
          printability_rating: 5,
          likes_count: 12,
          comments_count: 0,
          reposts_count: 0,
          views_count: 0,
          created_at: "2026-07-10T00:00:00Z",
        },
      ],
    );
    renderModel();

    fireEvent.click(await screen.findByText("Напечатали"));

    expect(await screen.findByText("Лучшие печати")).toBeTruthy();
    const authorBtn = await screen.findByRole("button", { name: "@maker42" });
    expect(authorBtn.parentElement?.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("▲ 12")).toBeTruthy();
  });
});
