import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OverlayProvider } from "../provider.tsx";
import { PrintSummaryPill, usePrinterAlerts } from "./alerthost.tsx";
import { ESCALATE_AFTER_MS, mockPrinterStatusSource, type MockPrinterStatusSource } from "./severity-from-printer.ts";

/*
  Тесты «готово когда» MF-442 (docs/epics/overlay.system.md §6): алерт появляется/
  исчезает подменой статуса тест-принтера, дедуп по printerId, эскалация warn→critical,
  «всё ок» — 0 attention-элементов (AlertHost рендерит null).
*/

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({ source }: { source: MockPrinterStatusSource }) {
  usePrinterAlerts(source);
  return null;
}

function renderHost(source: MockPrinterStatusSource) {
  render(
    <OverlayProvider>
      <Harness source={source} />
    </OverlayProvider>,
  );
}

describe("AlertHost / usePrinterAlerts", () => {
  it("«всё ок» — без проблем AlertHost не рендерит ни одного attention-элемента", () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    renderHost(source);
    expect(screen.queryByTestId("overlay-alert-host")).toBeNull();
  });

  it("подменой статуса тест-принтера алерт появляется, при восстановлении исчезает", async () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    renderHost(source);

    act(() => source.setProblem("p1", "jam"));
    expect(await screen.findByText("Ender 3: Засор экструдера")).toBeTruthy();
    expect(screen.getByText(/Пластик не подаётся/)).toBeTruthy();

    act(() => source.setProblem("p1", null));
    expect(screen.queryByText("Ender 3: Засор экструдера")).toBeNull();
    expect(screen.queryByTestId("overlay-alert-host")).toBeNull();
  });

  it("критичная причина (обрыв филамента) сразу даёт critical-карточку с пульсом", async () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    renderHost(source);
    act(() => source.setProblem("p1", "filament_runout"));
    const card = (await screen.findByText("Ender 3: Обрыв филамента")).closest(".ovlAlert");
    expect(card?.getAttribute("data-severity")).toBe("critical");
    expect(card?.getAttribute("data-pulse")).toBe("true");
    expect(card?.getAttribute("role")).toBe("alert");
  });

  it("дедуп по printerId: повторная проблема на том же принтере не плодит карточки", async () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    renderHost(source);
    act(() => source.setProblem("p1", "jam"));
    await screen.findByText("Ender 3: Засор экструдера");
    act(() => source.setProblem("p1", "jam"));
    expect(screen.getAllByTestId("overlay-alert-host")).toHaveLength(1);
    expect(screen.getAllByText(/Засор экструдера/)).toHaveLength(1);
  });

  it("эскалация warn→critical по времени без реакции", async () => {
    vi.useFakeTimers();
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    renderHost(source);
    act(() => source.setProblem("p1", "jam"));
    // Под fake timers findByText зависнет — waitFor полагается на реальный setTimeout,
    // а act() уже синхронно применил обновление, так что достаточно getByText.
    let card = screen.getByText("Ender 3: Засор экструдера").closest(".ovlAlert");
    expect(card?.getAttribute("data-severity")).toBe("warn");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESCALATE_AFTER_MS + 16_000);
    });
    card = screen.getByText("Ender 3: Засор экструдера").closest(".ovlAlert");
    expect(card?.getAttribute("data-severity")).toBe("critical");
    vi.useRealTimers();
  });

  it("действия карточки (Пауза/Стоп/Разобраться) зовут onAction с printerId", async () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    const onAction = vi.fn();
    render(
      <OverlayProvider>
        <ActionHarness source={source} onAction={onAction} />
      </OverlayProvider>,
    );
    act(() => source.setProblem("p1", "jam"));
    await screen.findByText("Ender 3: Засор экструдера");
    fireEvent.click(screen.getByText("Стоп"));
    expect(onAction).toHaveBeenCalledWith("p1", "stop");
  });

  it("ручной крестик скрывает алерт", async () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    renderHost(source);
    act(() => source.setProblem("p1", "jam"));
    await screen.findByText("Ender 3: Засор экструдера");
    fireEvent.click(screen.getByLabelText("Скрыть алерт"));
    expect(screen.queryByText("Ender 3: Засор экструдера")).toBeNull();
  });

  it("printingCount считает принтеры без проблем", () => {
    const source = mockPrinterStatusSource([
      { id: "p1", name: "Ender 3" },
      { id: "p2", name: "Prusa" },
    ]);
    let count = -1;
    function CountHarness() {
      const { printingCount } = usePrinterAlerts(source);
      count = printingCount;
      return null;
    }
    render(
      <OverlayProvider>
        <CountHarness />
      </OverlayProvider>,
    );
    expect(count).toBe(2);
  });
});

describe("PrintSummaryPill", () => {
  it("не рендерится при count=0", () => {
    render(<PrintSummaryPill count={0} />);
    expect(screen.queryByTestId("print-summary-pill")).toBeNull();
  });

  it("показывает приглушённую сводку при count>0", () => {
    render(<PrintSummaryPill count={3} />);
    expect(screen.getByTestId("print-summary-pill").textContent).toBe("Печатают 3");
  });
});

function ActionHarness({ source, onAction }: { source: MockPrinterStatusSource; onAction: (id: string, action: string) => void }) {
  usePrinterAlerts(source, onAction);
  return null;
}
