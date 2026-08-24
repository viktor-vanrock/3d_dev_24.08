import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { HeroCarousel } from "./hero.tsx";

// Hero-карусель (MF-512, docs/design/projects.page.md §2): вырожденные случаи (0/1/N featured)
// — самое важное для регрессии, т.к. «0 featured → секции нет вообще» легко сломать заглушкой.
// OverlayProvider — слайды/точки зовут useInteractionSound() (MF-615, sound.md §3), которому
// нужен контекст overlay для muted, как и другим экранам с useOverlay().

function renderHero() {
  return render(
    <OverlayProvider>
      <HeroCarousel />
    </OverlayProvider>,
  );
}

function mockModels(models: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ models, has_more: false }), { status: 200 })),
  );
}

function model(id: string, title: string) {
  return {
    id,
    title,
    description: null,
    status: "ready",
    source_format: "stl",
    craft: "3d_printing",
    created_at: new Date(0).toISOString(),
    votes_up: 0,
    votes_down: 0,
    downloads_count: 0,
    tags: [],
    thumb_url: null,
    owner: { id: "u1", username: "maker" },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HeroCarousel", () => {
  it("0 featured → ничего не рендерит (не пустая заглушка)", async () => {
    mockModels([]);
    const { container } = renderHero();
    await waitFor(() => expect(container.querySelector(".heroCarouselSkeleton")).toBeNull());
    expect(container.querySelector(".heroCarousel")).toBeNull();
  });

  it("ошибка загрузки featured → тихо ничего не рендерит", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { container } = renderHero();
    await waitFor(() => expect(container.querySelector(".heroCarouselSkeleton")).toBeNull());
    expect(container.querySelector(".heroCarousel")).toBeNull();
  });

  it("1 слайд → рендерится без индикатора-точек", async () => {
    mockModels([model("m1", "Часы-компас")]);
    renderHero();
    expect(await screen.findAllByText("Часы-компас")).not.toHaveLength(0);
    expect(screen.queryByRole("tablist", { name: "Слайды" })).toBeNull();
  });

  it("несколько слайдов → рендерится с точкой на каждый слайд", async () => {
    mockModels([model("m1", "Часы-компас"), model("m2", "Ваза-спираль"), model("m3", "Держатель")]);
    renderHero();
    await screen.findAllByText("Часы-компас");
    const dots = screen.getAllByRole("tab");
    expect(dots).toHaveLength(3);
    expect(dots[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("thumb_url=null → branded-placeholder вместо пустого превью (§14.3 п.4)", async () => {
    mockModels([model("m1", "Часы-компас")]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    expect(container.querySelector(".heroSlidePlaceholder")).not.toBeNull();
    expect(container.querySelector(".heroSlideImg")).toBeNull();
  });

  it("thumb_url задан → рендерит фото, без плейсхолдера", async () => {
    mockModels([{ ...model("m1", "Часы-компас"), thumb_url: "/uploads/m1.webp" }]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    expect(container.querySelector(".heroSlideImg")).not.toBeNull();
    expect(container.querySelector(".heroSlidePlaceholder")).toBeNull();
  });

  // Свайп (MF-606): pointerdown/move/up прямо на .heroCarousel имитирует реальный жест —
  // захват pointer'а (setPointerCapture) включается лениво, только после порога TAP_MOVE_THRESHOLD,
  // поэтому здесь он не мешает (событие и так адресовано контейнеру, а не потомку).
  function swipe(container: HTMLElement, deltaX: number) {
    const carousel = container.querySelector(".heroCarousel")!;
    fireEvent.pointerDown(carousel, { clientX: 200, pointerId: 1 });
    if (deltaX !== 0) fireEvent.pointerMove(carousel, { clientX: 200 + deltaX, pointerId: 1 });
    fireEvent.pointerUp(carousel, { clientX: 200 + deltaX, pointerId: 1 });
  }

  it("свайп влево дальше порога → следующий слайд", async () => {
    mockModels([model("m1", "Часы-компас"), model("m2", "Ваза-спираль")]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    swipe(container, -100);
    await screen.findAllByText("Ваза-спираль");
  });

  it("свайп вправо дальше порога → предыдущий слайд (зацикливание)", async () => {
    mockModels([model("m1", "Часы-компас"), model("m2", "Ваза-спираль")]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    swipe(container, 100);
    await screen.findAllByText("Ваза-спираль");
  });

  it("свайп ниже порога свайпа → не листает и не открывает проект", async () => {
    mockModels([model("m1", "Часы-компас"), model("m2", "Ваза-спираль")]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    const pathBefore = window.location.pathname;
    swipe(container, 20);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryAllByText("Часы-компас").length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe(pathBefore);
  });

  it("свайп дальше порога не открывает проект (перелистывает, не тап)", async () => {
    mockModels([model("m1", "Часы-компас"), model("m2", "Ваза-спираль")]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    window.history.pushState(null, "", "/project");
    swipe(container, -100);
    await screen.findAllByText("Ваза-спираль");
    expect(window.location.pathname).toBe("/project");
  });

  // Реальный тап/клик (без pointer-драга) не должен зависеть от ручной детекции в endDrag —
  // pointer capture в этом случае не захватывается вовсе (см. handlePointerMove), так что click
  // естественным путём браузера доходит до настоящей цели: кнопки слайда или конкретной точки.
  it("клик по кнопке слайда (без сдвига) открывает проект", async () => {
    mockModels([model("m1", "Часы-компас"), model("m2", "Ваза-спираль")]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    window.history.pushState(null, "", "/project");
    fireEvent.click(container.querySelector(".heroSlideHit")!);
    expect(window.location.pathname).toBe("/project/m1");
  });

  it("клик по неактивной точке переключает слайд, а не открывает проект", async () => {
    mockModels([model("m1", "Часы-компас"), model("m2", "Ваза-спираль"), model("m3", "Держатель")]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    window.history.pushState(null, "", "/project");
    const dots = screen.getAllByRole("tab");
    fireEvent.click(dots[2]!);
    await screen.findAllByText("Держатель");
    expect(window.location.pathname).toBe("/project");
    expect(container.querySelector(".heroSlideTitle")?.textContent).toBe("Держатель");
  });

  // Второй раунд QA (баг уже утёк на прод v26.2.160): setPointerCapture НЕ ретаргетит нативный
  // click, который браузер синтезирует после touchend по исходной точке касания — это отдельный
  // от pointer capture механизм, jsdom его не эмулирует вовсе. Единственное, что можно проверить
  // юнит-тестом — что preventDefault реально вызывается на move, как только жест признан драгом
  // (это и гасит тот компенсирующий click в реальном браузере); сам факт устранения ложной
  // навигации проверен вживую на dev.3mf.tech (Playwright + CDP touch, см. карточку).
  it("драг дальше TAP_MOVE_THRESHOLD гасит дефолтное действие move-события (защита от ghost-click)", async () => {
    mockModels([model("m1", "Часы-компас"), model("m2", "Ваза-спираль")]);
    const { container } = renderHero();
    await screen.findAllByText("Часы-компас");
    const carousel = container.querySelector(".heroCarousel")!;
    fireEvent.pointerDown(carousel, { clientX: 200, pointerId: 1 });
    const moveEvent = new PointerEvent("pointermove", {
      clientX: 185,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(moveEvent, "preventDefault");
    fireEvent(carousel, moveEvent);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
