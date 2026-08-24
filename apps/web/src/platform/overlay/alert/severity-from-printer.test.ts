import { describe, expect, it, vi } from "vitest";
import { ESCALATE_AFTER_MS, mockPrinterStatusSource, severityFromPrinter } from "./severity-from-printer.ts";

/*
  Тесты «готово когда» MF-442 §6: severityFromPrinter — критичные причины сразу
  critical, warn-причины эскалируют по времени (urgCol-правило демо, перенесённое
  на «не отреагировали»). mockPrinterStatusSource — контракт PrinterStatusSource
  за которым скрывается ещё не поднятая телеметрия MF-26 (§8).
*/

describe("severityFromPrinter", () => {
  it("критичная причина (обрыв филамента) — сразу critical, эскалация не нужна", () => {
    expect(severityFromPrinter("filament_runout", 0)).toBe("critical");
    expect(severityFromPrinter("thermal_runaway", 0)).toBe("critical");
    expect(severityFromPrinter("adhesion_fail", 0)).toBe("critical");
  });

  it("warn-причина (засор) остаётся warn до порога эскалации", () => {
    expect(severityFromPrinter("jam", 0)).toBe("warn");
    expect(severityFromPrinter("jam", ESCALATE_AFTER_MS - 1)).toBe("warn");
  });

  it("warn-причина эскалирует в critical по достижении порога без реакции", () => {
    expect(severityFromPrinter("jam", ESCALATE_AFTER_MS)).toBe("critical");
    expect(severityFromPrinter("offline", ESCALATE_AFTER_MS + 60_000)).toBe("critical");
  });
});

describe("mockPrinterStatusSource", () => {
  it("изначально все принтеры печатают нормально (problem=null)", () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    const onUpdate = vi.fn();
    source.subscribe(onUpdate);
    expect(onUpdate).toHaveBeenCalledWith([{ printerId: "p1", printerName: "Ender 3", problem: null, since: expect.any(Number) }]);
  });

  it("setProblem подменяет статус тест-принтера и уведомляет подписчиков", () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    const onUpdate = vi.fn();
    source.subscribe(onUpdate);
    onUpdate.mockClear();

    source.setProblem("p1", "jam");
    expect(onUpdate).toHaveBeenCalledOnce();
    const [statuses] = onUpdate.mock.calls[0]!;
    expect(statuses[0].problem).toBe("jam");

    source.setProblem("p1", null);
    const [recovered] = onUpdate.mock.calls[1]!;
    expect(recovered[0].problem).toBeNull();
  });

  it("setProblem для неизвестного printerId — no-op", () => {
    const source = mockPrinterStatusSource([{ id: "p1", name: "Ender 3" }]);
    const onUpdate = vi.fn();
    source.subscribe(onUpdate);
    onUpdate.mockClear();
    source.setProblem("unknown", "jam");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
