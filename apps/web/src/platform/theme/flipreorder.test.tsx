import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { useFlipReorder } from "./flipreorder.ts";

// FLIP-хук для пересортировки списков (community.md §7.5, MF-932) — единственный потребитель
// сейчас: посты треда при Q&A accept/vote (соберёт Front). Здесь проверяем сам примитив в отрыве
// от разметки постов: Invert (мгновенный transform без transition) → Play (снятие transform со
// сложившимся transition на следующем кадре) → cleanup по transitionend, плюс reduced-motion.

function List({ order }: { order: string[] }) {
  const flipRef = useFlipReorder(order);
  return (
    <div>
      {order.map((key) => (
        <div key={key} data-testid={key} ref={flipRef(key)}>
          {key}
        </div>
      ))}
    </div>
  );
}

function Harness({ order }: { order: string[] }) {
  const [current, setCurrent] = useState(order);
  return (
    <div>
      <button onClick={() => setCurrent((prev) => [...prev].reverse())}>reorder</button>
      <List order={current} />
    </div>
  );
}

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

let rafCallback: FrameRequestCallback | null = null;

beforeEach(() => {
  mockMatchMedia(false);
  rafCallback = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallback = cb;
    return 0;
  });
  // Раскладка по индексу среди соседей — имитирует вертикальный список фиксированной высоты,
  // так что позиция элемента реально меняется между "First" (до реордера) и "Last" (после).
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const siblings = Array.from(this.parentElement?.children ?? []);
    const index = siblings.indexOf(this);
    const top = index * 40;
    return {
      width: 300,
      height: 40,
      top,
      left: 0,
      right: 300,
      bottom: top + 40,
      x: 0,
      y: top,
      toJSON() {
        return this;
      },
    } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFlipReorder", () => {
  it("на переезд ставит Invert-transform без transition, затем на кадре включает Play-transition и снимает transform", () => {
    const { getByTestId, getByText } = render(<Harness order={["a", "b"]} />);
    fireEvent.click(getByText("reorder"));

    const a = getByTestId("a") as HTMLElement;
    expect(a.style.transition).toBe("none");
    expect(a.style.transform).toBe("translate(0px, -40px)");

    act(() => rafCallback?.(0));
    expect(a.style.transform).toBe("");
    expect(a.style.transition).toBe("transform var(--dur-reveal) var(--ease-out)");

    // jsdom не реализует TransitionEvent.propertyName через fireEvent-init (jsdom/jsdom#1781) —
    // собираем событие руками, чтобы проверить, что cleanup слушает именно propertyName.
    const transitionEnd = new Event("transitionend", { bubbles: true }) as unknown as TransitionEvent;
    Object.defineProperty(transitionEnd, "propertyName", { value: "transform" });
    fireEvent(a, transitionEnd);
    expect(a.style.transition).toBe("");
    expect(a.style.willChange).toBe("");
  });

  it("элемент, не сменивший позицию, transform не получает", () => {
    const { getByTestId, getByText } = render(<Harness order={["a", "b", "c"]} />);
    // reverse ["a","b","c"] -> ["c","b","a"]: средний элемент "b" остаётся на месте (top 40).
    fireEvent.click(getByText("reorder"));
    const b = getByTestId("b") as HTMLElement;
    expect(b.style.transform).toBe("");
  });

  it("prefers-reduced-motion — список перестраивается без FLIP-анимации", () => {
    mockMatchMedia(true);
    const { getByTestId, getByText } = render(<Harness order={["a", "b"]} />);
    fireEvent.click(getByText("reorder"));

    const a = getByTestId("a") as HTMLElement;
    expect(a.style.transform).toBe("");
    expect(rafCallback).toBeNull();
  });
});
