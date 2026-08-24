import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import type { Section } from "./types.ts";
import { useSectionSwipeNav } from "./navswipe.ts";
import { NAV_ITEMS } from "./navitems.ts";

// Свайп между разделами (docs/design/touch.nav.md §2, MF-433 Фаза 2): пороговое/флик-срабатывание,
// axis-lock, сопротивление на краях реестра — та же техника, что projects/hero.test.tsx уже
// проверяет для карусели (MF-606), здесь тот же приём для нав-жеста.

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function Harness({ section, onSectionChange }: { section: Section; onSectionChange: (s: Section) => void }) {
  const swipe = useSectionSwipeNav(section, onSectionChange);
  return (
    <div
      data-testid="surface"
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
    >
      <div className="heroCarousel" data-testid="hero">
        hero
      </div>
    </div>
  );
}

function renderHarness(section: Section, onSectionChange = vi.fn()) {
  const utils = render(
    <OverlayProvider>
      <Harness section={section} onSectionChange={onSectionChange} />
    </OverlayProvider>,
  );
  return { onSectionChange, ...utils };
}

// Ширина фиксируется моком (jsdom/happy-dom без layout даёт 0) — timeStamp разнесён на 300ms,
// чтобы порог «дистанция ИЛИ флик» проверялся по факту сдвига, а не по случайной скорости из-за
// нулевой длительности синтетического события.
function swipe(target: Element, deltaX: number, deltaY = 0) {
  fireEvent.pointerDown(target, { clientX: 200, clientY: 200, pointerId: 1, timeStamp: 0 });
  fireEvent.pointerMove(target, { clientX: 200 + deltaX, clientY: 200 + deltaY, pointerId: 1, timeStamp: 150 });
  fireEvent.pointerUp(target, { clientX: 200 + deltaX, clientY: 200 + deltaY, pointerId: 1, timeStamp: 300 });
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 300,
    height: 600,
    top: 0,
    left: 0,
    right: 300,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON() {
      return this;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSectionSwipeNav (touch.nav.md §2)", () => {
  it("на ≤640px свайп влево дальше порога (25% ширины) переключает на следующий раздел реестра", () => {
    mockMatchMedia(true);
    const { onSectionChange, getByTestId } = renderHarness("home");
    swipe(getByTestId("surface"), -100);
    const fromIndex = NAV_ITEMS.findIndex((item) => item.section === "home");
    expect(onSectionChange).toHaveBeenCalledWith(NAV_ITEMS[fromIndex + 1]!.section);
  });

  it("свайп вправо дальше порога переключает на предыдущий раздел", () => {
    mockMatchMedia(true);
    const { onSectionChange, getByTestId } = renderHarness("market");
    swipe(getByTestId("surface"), 100);
    const fromIndex = NAV_ITEMS.findIndex((item) => item.section === "market");
    expect(onSectionChange).toHaveBeenCalledWith(NAV_ITEMS[fromIndex - 1]!.section);
  });

  it("свайп ниже порога — не переключает раздел (rubber-band откат)", () => {
    mockMatchMedia(true);
    const { onSectionChange, getByTestId } = renderHarness("home");
    swipe(getByTestId("surface"), 20);
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it("на краю реестра (первый раздел) свайп вправо не переключает — некуда", () => {
    mockMatchMedia(true);
    const { onSectionChange, getByTestId } = renderHarness("home");
    swipe(getByTestId("surface"), 100);
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it("вертикальный жест (скролл ленты) не триггерит смену раздела", () => {
    mockMatchMedia(true);
    const { onSectionChange, getByTestId } = renderHarness("home");
    swipe(getByTestId("surface"), 5, 120);
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it("жест внутри hero-карусели игнорируется (excludeSelector) — карусель забирает его себе", () => {
    mockMatchMedia(true);
    const { onSectionChange, getByTestId } = renderHarness("home");
    swipe(getByTestId("hero"), -100);
    expect(onSectionChange).not.toHaveBeenCalled();
  });

  it("на десктопе (>640px) свайп не переключает раздел", () => {
    mockMatchMedia(false);
    const { onSectionChange, getByTestId } = renderHarness("home");
    swipe(getByTestId("surface"), -100);
    expect(onSectionChange).not.toHaveBeenCalled();
  });
});
