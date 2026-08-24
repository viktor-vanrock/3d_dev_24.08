import type { Severity } from "../severity.ts";

/*
  Каталог причин поломки печати (docs/epics/overlay.system.md §6, MF-442): что
  показываем + человекочитаемое «почему» + стартовая серьёзность до эскалации по
  времени (severity-from-printer.ts). Источник перечня — демо + design/status-alerts.md.
*/

export type PrinterProblem = "filament_runout" | "jam" | "thermal_runaway" | "adhesion_fail" | "offline";

export interface ProblemInfo {
  what: string;
  why: string;
  baseSeverity: Extract<Severity, "warn" | "critical">;
}

// baseSeverity=critical — угроза заказу/безопасности сразу, ждать эскалации нельзя
// (обрыв/термранэвей/отвал теряют деталь или опасны). jam/offline стартуют warn —
// принтер может восстановиться сам (долив, переподключение) — и эскалируют по времени.
export const PROBLEM_CATALOG: Record<PrinterProblem, ProblemInfo> = {
  filament_runout: {
    what: "Обрыв филамента",
    why: "Катушка закончилась или нить порвалась перед экструдером",
    baseSeverity: "critical",
  },
  jam: {
    what: "Засор экструдера",
    why: "Пластик не подаётся — забито сопло или трубка подачи",
    baseSeverity: "warn",
  },
  thermal_runaway: {
    what: "Термораннэвей",
    why: "Температура хотэнда или стола вышла из-под контроля, сработала защита",
    baseSeverity: "critical",
  },
  adhesion_fail: {
    what: "Отвал детали",
    why: "Модель отклеилась от стола, печать сорвана",
    baseSeverity: "critical",
  },
  offline: {
    what: "Принтер офлайн",
    why: "Потеряна связь с принтером — проверьте питание и сеть",
    baseSeverity: "warn",
  },
};

export function problemInfo(problem: PrinterProblem): ProblemInfo {
  return PROBLEM_CATALOG[problem];
}
