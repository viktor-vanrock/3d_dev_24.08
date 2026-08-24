import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { BottomTabBar } from "./bottomtabbar.tsx";
import { NAV_ITEMS } from "./navitems.ts";

const tick = vi.fn();
const nav = vi.fn();
vi.mock("@platform/sound", () => ({
  useInteractionSound: () => ({ tick, nav, toggle: vi.fn(), cta: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), offline: vi.fn() }),
}));

// Bottom-tab (docs/design/touch.nav.md §1, MF-433 Фаза 2): читает NAV_ITEMS как есть — тест
// проверяет количество табов ИЗ реестра (не хардкод «3»/«4»), чтобы правка navitems.ts (MF-806)
// не ломала этот тест каждый раз при смене состава разделов.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  tick.mockClear();
  nav.mockClear();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
});

function renderBar(section: (typeof NAV_ITEMS)[number]["section"], onSectionChange = vi.fn()) {
  return {
    onSectionChange,
    ...render(
      <OverlayProvider>
        <BottomTabBar section={section} onSectionChange={onSectionChange} />
      </OverlayProvider>,
    ),
  };
}

describe("BottomTabBar (touch.nav.md §1)", () => {
  it("монтирует пять мобильных табов из канонического NAV_ITEMS без Идей", () => {
    const { container } = renderBar("home");
    const bar = container.querySelector(".bottomTabBar");
    expect(bar).toBeTruthy();
    expect(bar?.querySelectorAll("button")).toHaveLength(5);
    expect([...bar!.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Дом",
      "Новости",
      "Проекты",
      "Принтеры",
      "Материалы",
    ]);
    expect(screen.queryByText("Идеи")).toBeNull();
  });

  it("активный раздел помечен aria-current", () => {
    renderBar("market");
    const active = screen.getByText("Проекты").closest("button")!;
    expect(active.getAttribute("aria-current")).toBe("page");
    const inactive = screen.getByText("Дом").closest("button")!;
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });

  it("на самостоятельном пользовательском слое не притворяется активным разделом", () => {
    const { container } = render(
      <OverlayProvider>
        <BottomTabBar section="market" activeSection={null} onSectionChange={() => {}} />
      </OverlayProvider>,
    );
    expect(container.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("тап по неактивному табу зовёт onSectionChange с его разделом", () => {
    const { onSectionChange } = renderBar("home");
    fireEvent.click(screen.getByText("Проекты"));
    expect(onSectionChange).toHaveBeenCalledWith("market");
  });

  it("тап по уже активному табу не зовёт onSectionChange повторно", () => {
    const { onSectionChange } = renderBar("home");
    fireEvent.click(screen.getByText("Дом"));
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it("тап по неактивному табу зовёт tick ровно раз (не tick+tick), затем nav (touch.nav.md §6)", () => {
    const { onSectionChange } = renderBar("home");
    const target = screen.getByText("Проекты").closest("button")!;
    fireEvent.pointerDown(target, { pointerId: 1 });
    fireEvent.click(target);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(onSectionChange).toHaveBeenCalledWith("market");
  });

  it("тап по уже активному табу тоже зовёт tick ровно раз, без nav", () => {
    renderBar("home");
    const target = screen.getByText("Дом").closest("button")!;
    fireEvent.pointerDown(target, { pointerId: 1 });
    fireEvent.click(target);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(nav).not.toHaveBeenCalled();
  });

  it("тап по пункту «Проекты» пишет каноническое событие project", async () => {
    const activationEvents: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        activationEvents.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }),
    );
    renderBar("home");

    fireEvent.click(screen.getByRole("button", { name: "Проекты" }));

    await waitFor(() => expect(activationEvents).toContainEqual({ event_name: "nav_item_click", props: { item: "project" } }));
  });
});
