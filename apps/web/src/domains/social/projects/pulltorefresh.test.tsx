import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { usePullToRefresh } from "./pulltorefresh.ts";

// Pull-to-refresh на «Проектах» (docs/design/touch.nav.md §3, MF-433 Фаза 2): скролл-контейнер —
// окно (scrollY===0 — триггер), протяжка вниз с сопротивлением, порог ~64px даёт "ready", отпускание
// после порога зовёт onRefresh; ниже порога — мгновенный откат без запроса.

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

function Harness({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const ptr = usePullToRefresh(onRefresh);
  return (
    <div
      data-testid="surface"
      data-phase={ptr.phase}
      onPointerDown={ptr.onPointerDown}
      onPointerMove={ptr.onPointerMove}
      onPointerUp={ptr.onPointerUp}
      onPointerCancel={ptr.onPointerCancel}
    />
  );
}

function renderHarness(onRefresh = vi.fn().mockResolvedValue(undefined)) {
  const utils = render(
    <OverlayProvider>
      <Harness onRefresh={onRefresh} />
    </OverlayProvider>,
  );
  return { onRefresh, ...utils };
}

function pull(target: Element, deltaY: number) {
  fireEvent.pointerDown(target, { clientX: 150, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(target, { clientX: 150, clientY: 100 + deltaY, pointerId: 1 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

describe("usePullToRefresh (touch.nav.md §3)", () => {
  it("scrollY===0 + протяжка вниз за порог (~64px) → phase='ready'", () => {
    mockMatchMedia(true);
    const { getByTestId } = renderHarness();
    pull(getByTestId("surface"), 200);
    expect(getByTestId("surface").dataset.phase).toBe("ready");
  });

  it("протяжка ниже порога → phase='pulling', отпускание не зовёт onRefresh", () => {
    mockMatchMedia(true);
    const { getByTestId, onRefresh } = renderHarness();
    const el = getByTestId("surface");
    pull(el, 20);
    expect(el.dataset.phase).toBe("pulling");
    fireEvent.pointerUp(el, { clientX: 150, clientY: 120, pointerId: 1 });
    expect(el.dataset.phase).toBe("idle");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("отпускание после порога → зовёт onRefresh, затем phase='success' → 'idle'", async () => {
    mockMatchMedia(true);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { getByTestId } = renderHarness(onRefresh);
    const el = getByTestId("surface");
    pull(el, 200);
    fireEvent.pointerUp(el, { clientX: 150, clientY: 300, pointerId: 1 });
    expect(el.dataset.phase).toBe("loading");
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(el.dataset.phase).toBe("success"));
    await waitFor(() => expect(el.dataset.phase).toBe("idle"), { timeout: 1000 });
  });

  it("scrollY !== 0 — жест не начинается вовсе", () => {
    mockMatchMedia(true);
    Object.defineProperty(window, "scrollY", { value: 40, configurable: true });
    const { getByTestId } = renderHarness();
    pull(getByTestId("surface"), 200);
    expect(getByTestId("surface").dataset.phase).toBe("idle");
  });

  it("протяжка вверх (обычный скролл) не запускает pull-to-refresh", () => {
    mockMatchMedia(true);
    const { getByTestId } = renderHarness();
    pull(getByTestId("surface"), -200);
    expect(getByTestId("surface").dataset.phase).toBe("idle");
  });

  it("на десктопе (>640px) жест не начинается", () => {
    mockMatchMedia(false);
    const { getByTestId } = renderHarness();
    pull(getByTestId("surface"), 200);
    expect(getByTestId("surface").dataset.phase).toBe("idle");
  });
});
