import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { ModelScreen } from "./model.tsx";

// Вкладка «Статистика» владельца (docs/design/model.card.visual.md §4, v3 §5): 5 StatTile,
// тон dim→ok по факту >0, «Комментарии»/«Напечатали» кликабельны (GAP-CSS §6.1).

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
    owner: { id: "u1", username: "tester", display_name: null, avatar_url: null, trusted_uploader: false },
    make_stats: { makes_count: 0, machines_count: 0, materials_count: 0, avg_printability_rating: null },
    top_combos: [],
    ...overrides,
  };
}

function mockFetch(model: ReturnType<typeof baseModel>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/models/m1/comments")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes("/models/m1")) return new Response(JSON.stringify({ model }), { status: 200 });
      return new Response(null, { status: 404 });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderModel(tab: "stats" | "comments" | "makes" = "stats") {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <ModelScreen user={user} section="market" onSectionChange={() => {}} id="m1" tab={tab} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("ModelScreen — вкладка «Статистика»", () => {
  it("называет действие форка понятным языком", async () => {
    mockFetch(baseModel());
    renderModel();

    // MF-1734 заменил нативный title на доступный Tooltip (ui.tsx) — подсказка живёт в
    // отдельном узле, связанном через aria-describedby, а не в атрибуте кнопки.
    const copy = await screen.findByRole("button", { name: "Сделать копию проекта" });
    const describedBy = copy.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Создать свою копию проекта для доработки");
  });

  it("оставляет сообщение о проблеме после вкладок и основного содержимого", async () => {
    mockFetch(baseModel());
    renderModel();

    await screen.findByRole("button", { name: "Сообщить о проблеме" });
    screen.getByRole("tablist", { name: "Раздел проекта" });

    expect(document.body.textContent!.indexOf("Раздел проекта")).toBeLessThan(document.body.textContent!.indexOf("Сообщить о проблеме"));
  });

  it("не растягивает подложку вкладок на всю строку", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/domains/commerce/model.css"), "utf8");
    const rule = styles.match(/\.modelSocialTabs > \.uiSegmentToggle \{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/align-self:\s*flex-start/);
  });

  it("показывает доступный бейдж у доверенного вкладчика в 48px-кнопке автора", async () => {
    mockFetch(baseModel({ owner: { id: "u1", username: "tester", display_name: null, avatar_url: null, trusted_uploader: true } }));
    renderModel();

    expect(await screen.findByRole("status", { name: "доверенный вкладчик" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "@tester доверенный вкладчик" }).style.minHeight).toBe("var(--touch-target-min)");
  });

  it("не показывает бейдж у остальных авторов", async () => {
    mockFetch(baseModel());
    renderModel();

    await screen.findByRole("button", { name: "@tester" });
    expect(screen.queryByRole("status", { name: "доверенный вкладчик" })).toBeNull();
  });

  it("владельцу показывает 5 плиток с приглушённым тоном по нулям + подпись «по нулям»", async () => {
    mockFetch(baseModel());
    renderModel();

    const tiles = within((await screen.findByText("Скачивания")).closest(".uiStatTileGrid") as HTMLElement);
    expect(tiles.getByText("Просмотры")).toBeTruthy();
    expect(tiles.getByText("Скачивания")).toBeTruthy();
    expect(tiles.getByText("Голоса")).toBeTruthy();
    expect(tiles.getByText("Комментарии")).toBeTruthy();
    expect(tiles.getByText("Напечатали")).toBeTruthy();
    expect(await screen.findByText("Статистика появится, когда проект начнут смотреть и скачивать")).toBeTruthy();
  });

  it("плитки разгораются (tone=ok) по факту >0 и не лгут нулём при отсутствующих полях API", async () => {
    mockFetch(
      baseModel({
        downloads_count: 7,
        votes_up: 5,
        votes_down: 1,
        make_stats: { makes_count: 3, machines_count: 1, materials_count: 1, avg_printability_rating: 4 },
      }),
    );
    renderModel();

    const downloadsTile = (await screen.findByText("Скачивания")).closest(".uiStatTile") as HTMLElement;
    expect(downloadsTile.getAttribute("data-tone")).toBe("ok");
    expect(within(downloadsTile).getByText("7")).toBeTruthy();

    // views_count/comments_count не отданы API — честный «—», не нолик (GAP-API, models.ts).
    const viewsTile = (await screen.findByText("Просмотры")).closest(".uiStatTile") as HTMLElement;
    expect(viewsTile.getAttribute("data-tone")).toBe("dim");
    expect(within(viewsTile).getByText("—")).toBeTruthy();
  });

  it("клик по «Комментарии»/«Напечатали» уводит на соответствующую вкладку", async () => {
    mockFetch(baseModel({ make_stats: { makes_count: 2, machines_count: 1, materials_count: 1, avg_printability_rating: 3.5 } }));
    renderModel();

    fireEvent.click(await screen.findByText("Напечатали", { selector: ".uiEyebrow" }));
    expect(window.location.pathname).toBe("/project/m1/makes");
  });
});
