import type { Severity } from "../severity.ts";
import { problemInfo, type PrinterProblem } from "./reasons.ts";

/*
  Модель серьёзности алертов печати (docs/epics/overlay.system.md §2/§6, MF-442):
  правило urgCol из демо, перенесённое на «не отреагировали» — если проблема с
  базовой серьёзностью warn не разрешена ESCALATE_AFTER_MS, она эскалирует в
  critical. Критичные причины (обрыв/термранэвей/отвал, см. reasons.ts) не ждут
  эскалации — они critical сразу, «яркость=важность» без задержки.
*/
export const ESCALATE_AFTER_MS = 10 * 60 * 1000;

export function severityFromPrinter(problem: PrinterProblem, ageMs: number): Extract<Severity, "warn" | "critical"> {
  const base = problemInfo(problem).baseSeverity;
  if (base === "critical") return "critical";
  return ageMs >= ESCALATE_AFTER_MS ? "critical" : "warn";
}

// Статус одного принтера в парке (источник — MF-26). problem=null — печатает
// нормально, ничего показывать не нужно (§ «Всё ок» не шумит).
export interface PrinterStatus {
  printerId: string;
  printerName: string;
  problem: PrinterProblem | null;
  since: number;
}

// Источник статусов за интерфейсом (§8 спеки: MF-26 к v1 может не быть живым потоком).
// Когда телеметрия появится, меняется только реализация источника — AlertHost и
// usePrinterAlerts (alerthost.tsx) от неё не зависят.
export interface PrinterStatusSource {
  subscribe(onUpdate: (statuses: PrinterStatus[]) => void): () => void;
}

export interface MockPrinter {
  id: string;
  name: string;
}

export interface MockPrinterStatusSource extends PrinterStatusSource {
  setProblem(printerId: string, problem: PrinterProblem | null): void;
}

// Мок-источник (демо-паттерн, §8): все принтеры печатают нормально, пока кто-то
// явно не позовёт setProblem — так тестам и dev-инструментам достаточно подменить
// статус тест-принтера, не поднимая реальную телеметрию.
export function mockPrinterStatusSource(printers: MockPrinter[]): MockPrinterStatusSource {
  const statuses = new Map<string, PrinterStatus>(
    printers.map((printer) => [
      printer.id,
      { printerId: printer.id, printerName: printer.name, problem: null, since: Date.now() },
    ]),
  );
  const listeners = new Set<(statuses: PrinterStatus[]) => void>();

  function notify() {
    const snapshot = Array.from(statuses.values());
    listeners.forEach((listener) => listener(snapshot));
  }

  return {
    subscribe(onUpdate) {
      listeners.add(onUpdate);
      onUpdate(Array.from(statuses.values()));
      return () => listeners.delete(onUpdate);
    },
    setProblem(printerId, problem) {
      const current = statuses.get(printerId);
      if (!current) return;
      statuses.set(printerId, { ...current, problem, since: Date.now() });
      notify();
    },
  };
}
