import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { OverlayProvider } from "./provider.tsx";
import { useOverlay } from "./index.ts";

/*
  Тесты «готово когда» MF-441 (docs/epics/overlay.system.md §6): стресс-очередь
  тостов, автоскрытие по severity, фокус-трап и Esc/фон у модалок, critical
  держится до действия, confirm() resolves как Promise<boolean>.
*/

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.useRealTimers();
});

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useOverlay>) => void }) {
  const overlay = useOverlay();
  useEffect(() => {
    onReady(overlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderOverlay() {
  let api!: ReturnType<typeof useOverlay>;
  render(
    <OverlayProvider>
      <Harness onReady={(overlay) => (api = overlay)} />
    </OverlayProvider>,
  );
  return () => api;
}

describe("toast", () => {
  it("располагает стек ниже фиксированной шапки без компенсации dev-бейджа", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/platform/overlay/overlay.css"), "utf8");
    const tokens = readFileSync(resolve(process.cwd(), "src/platform/theme/tokens.css"), "utf8");
    const toasterStart = styles.indexOf(".ovlToaster {");
    const toasterEnd = styles.indexOf(".ovlToast {", toasterStart);
    const toasterStyles = styles.slice(toasterStart, toasterEnd);
    const headerAwareStart = styles.indexOf("body:has(.homeTopbar) .ovlToaster");
    const headerAwareStyles = styles.slice(headerAwareStart, styles.indexOf("}", headerAwareStart));

    expect(headerAwareStyles).toMatch(/top:\s*calc\(var\(--header-safe\)\s*\+\s*16px\)/);
    expect(toasterStyles).not.toContain("dev-banner");
    expect(tokens).toMatch(
      /@media \(min-width: 641px\) \{[\s\S]*?--header-safe:\s*max\(110px,\s*calc\(72px \+ env\(safe-area-inset-top\)\)\);/,
    );
  });

  it("overlay-host не зависит от dev-бейджа", () => {
    vi.stubEnv("VITE_DEV_BANNER", "1");
    renderOverlay();

    expect(document.querySelector(".ovlHost")?.getAttribute("data-dev-banner")).toBeNull();
  });

  it("TV close-control резервирует цель не менее 64px, сохраняя компактную иконку", () => {
    const overlayCss = readFileSync(resolve(process.cwd(), "src/platform/overlay/overlay.css"), "utf8");

    expect(overlayCss).toMatch(
      /@media \(min-width: 1200px\) and \(min-height: 640px\) \{[\s\S]*?\.ovlToastClose[\s\S]*?min-width: var\(--tv-target-min\);[\s\S]*?min-height: var\(--tv-target-min\);/,
    );
    expect(overlayCss).toMatch(/\.ovlToastClose[\s\S]*?font-size: 12px;/);
  });

  it("стресс-тест: 10 вызовов не ломает раскладку — видно не больше 2 тостов одновременно", async () => {
    const getApi = renderOverlay();
    for (let i = 0; i < 10; i += 1) {
      getApi().toast({ title: `Тост ${i}`, duration: "sticky" });
    }
    const toasts = await screen.findAllByText(/Тост \d/);
    expect(toasts.length).toBe(2);
  });

  it("успех-тост исчезает сам по истечении длительности", async () => {
    vi.useFakeTimers();
    const getApi = renderOverlay();
    act(() => {
      getApi().toast({ severity: "success", title: "Готово" });
    });
    expect(screen.getByText("Готово")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(4100);
    expect(screen.queryByText("Готово")).toBeNull();
    vi.useRealTimers();
  });

  it("critical-тост держится до явного действия (sticky по умолчанию)", async () => {
    vi.useFakeTimers();
    const getApi = renderOverlay();
    act(() => {
      getApi().toast({ severity: "critical", title: "Обрыв филамента" });
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.getByText("Обрыв филамента")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Закрыть уведомление"));
    expect(screen.queryByText("Обрыв филамента")).toBeNull();
    vi.useRealTimers();
  });

  it("action/undo вызывает колбэк и закрывает тост", async () => {
    const getApi = renderOverlay();
    const onAction = vi.fn();
    act(() => {
      getApi().toast({ title: "Удалено", duration: "sticky", action: { label: "Отменить", onAction } });
    });
    fireEvent.click(screen.getByText("Отменить"));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByText("Удалено")).toBeNull();
  });

  it("update() меняет содержимое существующего тоста (для прогресс-баров MF-9/443)", () => {
    const getApi = renderOverlay();
    let handle!: ReturnType<ReturnType<typeof useOverlay>["toast"]>;
    act(() => {
      handle = getApi().toast({ title: "Загрузка", message: "0%", duration: "sticky" });
    });
    expect(screen.getByText("0%")).toBeTruthy();
    act(() => {
      handle.update({ message: "50%" });
    });
    expect(screen.getByText("50%")).toBeTruthy();
  });
});

describe("modal/confirm", () => {
  it("широкая форма получает внешний доступный крестик и закрывается им", async () => {
    const user = userEvent.setup();
    const getApi = renderOverlay();
    getApi().modal({ title: "Редактировать проект", size: "wide", content: <div>Поля проекта</div> });

    const dialog = await screen.findByRole("dialog", { name: "Редактировать проект" });
    const close = screen.getByRole("button", { name: "Закрыть" });

    expect(dialog.getAttribute("data-size")).toBe("wide");
    expect(close.closest(".ovlModal")).toBeNull();

    await user.click(close);
    expect(screen.queryByRole("dialog", { name: "Редактировать проект" })).toBeNull();
  });

  it("confirm() резолвится true по подтверждению", async () => {
    const getApi = renderOverlay();
    const resultPromise = getApi().confirm({ title: "Удалить модель?", destructive: true });
    fireEvent.click(await screen.findByText("Подтвердить"));
    expect(await resultPromise).toBe(true);
  });

  it("confirm() резолвится false по отмене", async () => {
    const getApi = renderOverlay();
    const resultPromise = getApi().confirm({ title: "Удалить модель?" });
    fireEvent.click(await screen.findByText("Отмена"));
    expect(await resultPromise).toBe(false);
  });

  it("фокус-трап: фокус уходит внутрь модалки при открытии", async () => {
    const getApi = renderOverlay();
    getApi().confirm({ title: "Подтвердите" });
    await waitFor(() => {
      expect(document.activeElement?.closest(".ovlModal")).toBeTruthy();
    });
  });

  it("Esc закрывает обычную (не critical) модалку", async () => {
    const getApi = renderOverlay();
    const resultPromise = getApi().confirm({ title: "Обычное подтверждение" });
    await screen.findByText("Обычное подтверждение");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(await resultPromise).toBe(false);
    expect(screen.queryByText("Обычное подтверждение")).toBeNull();
  });

  it("клик по фону закрывает обычную модалку", async () => {
    const getApi = renderOverlay();
    const resultPromise = getApi().confirm({ title: "Клик мимо" });
    await screen.findByText("Клик мимо");
    fireEvent.pointerDown(screen.getByTestId("overlay-modal-backdrop"));
    expect(await resultPromise).toBe(false);
  });

  it("critical-модалка НЕ закрывается по Esc/фону — только явным действием", async () => {
    const getApi = renderOverlay();
    const resultPromise = getApi().confirm({ title: "Остановить печать?", severity: "critical" });
    await screen.findByText("Остановить печать?");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(screen.getByTestId("overlay-modal-backdrop"));
    expect(screen.getByText("Остановить печать?")).toBeTruthy();
    fireEvent.click(screen.getByText("Подтвердить"));
    expect(await resultPromise).toBe(true);
  });

  it("очередь модалок: глубина 1 — вторая ждёт закрытия первой", async () => {
    const getApi = renderOverlay();
    act(() => {
      void getApi().confirm({ title: "Первая" });
      void getApi().confirm({ title: "Вторая" });
    });
    expect(screen.getByText("Первая")).toBeTruthy();
    expect(screen.queryByText("Вторая")).toBeNull();
    fireEvent.click(screen.getByText("Отмена"));
    expect(await screen.findByText("Вторая")).toBeTruthy();
  });
});

describe("sheet", () => {
  it("открывается и закрывается по кнопке закрытия", async () => {
    const getApi = renderOverlay();
    getApi().sheet({ title: "Детали", content: <div>Содержимое шита</div> });
    expect(await screen.findByText("Содержимое шита")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Закрыть"));
    expect(screen.queryByText("Содержимое шита")).toBeNull();
  });
});
