import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { PwaRuntime } from "./pwaruntime.tsx";

const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
let needRefresh = false;
let offlineReady = false;
const setNeedRefresh = (v: boolean) => (needRefresh = v);
const setOfflineReady = (v: boolean) => (offlineReady = v);

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  }),
}));

function renderRuntime() {
  return render(
    <OverlayProvider>
      <PwaRuntime />
    </OverlayProvider>,
  );
}

// MF-432: SW update/offline-ready — оба через существующий toast (overlay/index.ts), не
// новый визуальный компонент (заметный UI без спеки Design не верстается).
describe("PwaRuntime", () => {
  afterEach(() => {
    cleanup();
    needRefresh = false;
    offlineReady = false;
    updateServiceWorker.mockClear();
    vi.unstubAllGlobals();
  });

  it("needRefresh=true — sticky toast «Обновить», клик зовёт updateServiceWorker(true)", () => {
    needRefresh = true;
    renderRuntime();
    expect(screen.getByText("Доступна новая версия")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("offlineReady=true — тост «готово к работе офлайн»", () => {
    offlineReady = true;
    renderRuntime();
    expect(screen.getByText("Приложение готово к работе офлайн")).toBeTruthy();
  });

  it("переход offline закрывает ранее показанный тост offline-ready", () => {
    offlineReady = true;
    renderRuntime();
    expect(screen.getByText("Приложение готово к работе офлайн")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.queryByText("Приложение готово к работе офлайн")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Нет сети")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.queryByText("Приложение готово к работе офлайн")).toBeNull();
    expect(screen.queryByText("Нет сети")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Соединение восстановлено")).toBeTruthy();
  });

  it("не показывает offline-ready после потери сети, если событие SW пришло позже", () => {
    const view = renderRuntime();

    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Нет сети")).toBeTruthy();

    offlineReady = true;
    act(() => {
      view.rerender(
        <OverlayProvider>
          <PwaRuntime />
        </OverlayProvider>,
      );
    });

    expect(screen.queryByText("Приложение готово к работе офлайн")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Нет сети")).toBeTruthy();

    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Соединение восстановлено")).toBeTruthy();
  });

  it("нет сети при монтировании — сразу sticky тост «Нет сети»", () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    renderRuntime();
    expect(screen.getByText("Нет сети")).toBeTruthy();
  });

  it("событие offline → online — тост сменяется на «Соединение восстановлено»", () => {
    renderRuntime();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("Нет сети")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("Нет сети")).toBeNull();
    expect(screen.getByText("Соединение восстановлено")).toBeTruthy();
  });

  it("повторные transitions не дублируют offline/recovery и явно помечают stale-данные", () => {
    renderRuntime();

    act(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getAllByText("Нет сети")).toHaveLength(1);
    expect(screen.getByText(/устаревшими/)).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("Нет сети")).toBeNull();
    expect(screen.getAllByText("Соединение восстановлено")).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("Нет сети")).toBeNull();
    expect(screen.getAllByText("Соединение восстановлено")).toHaveLength(1);
  });
});
