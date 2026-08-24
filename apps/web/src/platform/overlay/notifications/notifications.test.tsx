import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { OverlayProvider } from "../provider.tsx";
import { useOverlay } from "../index.ts";
import { mockPrinterStatusSource } from "../alert/severity-from-printer.ts";
import { usePrinterAlerts } from "../alert/alerthost.tsx";

/*
  Тесты «готово когда» MF-443 §6: бейдж поднимается на новое событие, открытие центра
  (markAllRead) гасит его, mute переключается и персистится, звук не звенит повторно
  на дедуп-вызов notify() с тем же id, алерт печати даёт РОВНО одну запись на эпизод
  (не на каждую эскалацию внутри него).
*/

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useOverlay>) => void }) {
  const overlay = useOverlay();
  useEffect(() => {
    onReady(overlay);
  });
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

describe("notifications.notify / markAllRead", () => {
  it("новое событие поднимает unreadCount", () => {
    const getApi = renderOverlay();
    expect(getApi().notifications.unreadCount).toBe(0);
    act(() => {
      getApi().notifications.notify({ group: "system", severity: "warn", title: "Привяжите принтер" });
    });
    expect(getApi().notifications.unreadCount).toBe(1);
    expect(getApi().notifications.items[0]?.title).toBe("Привяжите принтер");
  });

  it("markAllRead() гасит бейдж, но не удаляет записи из ленты", () => {
    const getApi = renderOverlay();
    act(() => {
      getApi().notifications.notify({ group: "system", severity: "warn", title: "Привяжите принтер" });
    });
    expect(getApi().notifications.unreadCount).toBe(1);
    act(() => getApi().notifications.markAllRead());
    expect(getApi().notifications.unreadCount).toBe(0);
    expect(getApi().notifications.items.length).toBe(1);
  });

  it("повторный notify() с тем же id — дедуп, не плодит записи", () => {
    const getApi = renderOverlay();
    act(() => {
      getApi().notifications.notify({ id: "system-welcome", group: "system", severity: "success", title: "Добро пожаловать" });
      getApi().notifications.notify({ id: "system-welcome", group: "system", severity: "success", title: "Добро пожаловать" });
    });
    expect(getApi().notifications.items.length).toBe(1);
    expect(getApi().notifications.unreadCount).toBe(1);
  });
});

describe("notifications.muted", () => {
  it("дефолт — уважает prefers-reduced-motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    const getApi = renderOverlay();
    expect(getApi().notifications.muted).toBe(true);
    window.matchMedia = original;
  });

  it("setMuted() переключает и персистится в localStorage", () => {
    const getApi = renderOverlay();
    act(() => getApi().notifications.setMuted(true));
    expect(getApi().notifications.muted).toBe(true);
    expect(localStorage.getItem("portal.overlay.muted")).toBe("1");
  });
});

describe("alert() → печать в центре уведомлений", () => {
  it("один эпизод проблемы = одна запись, эскалация warn→critical не дублирует", async () => {
    vi.useFakeTimers();
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    let api!: ReturnType<typeof useOverlay>;
    render(
      <OverlayProvider>
        <Harness onReady={(overlay) => (api = overlay)} />
        <PrinterHarness source={source} />
      </OverlayProvider>,
    );

    act(() => source.setProblem("p1", "jam"));
    expect(api.notifications.items.filter((item) => item.group === "print").length).toBe(1);

    // Эскалация warn→critical для того же незакрытого эпизода — новая запись не появляется.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    });
    expect(api.notifications.items.filter((item) => item.group === "print").length).toBe(1);

    // Восстановление и новая поломка того же принтера — это уже НОВЫЙ эпизод, вторая запись.
    act(() => source.setProblem("p1", null));
    act(() => source.setProblem("p1", "jam"));
    expect(api.notifications.items.filter((item) => item.group === "print").length).toBe(2);
    vi.useRealTimers();
  });
});

function PrinterHarness({ source }: { source: ReturnType<typeof mockPrinterStatusSource> }) {
  usePrinterAlerts(source);
  return null;
}
