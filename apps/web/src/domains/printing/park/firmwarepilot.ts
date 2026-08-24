import type { FirmwarePilotStage, FirmwarePilotStatus } from "@portal/contracts/http/devices";

export interface PilotInfo {
  label: string;
  /** Второй dim-текст под пилюлей — сегодня заполнен только для `stale` (park.md §3.3). */
  secondLine: string | null;
  hint: string;
  tone: "dim" | "warn";
  /** Доступное имя строки целиком (иконка+текст), включает модель — park.md §3.2/§3.3. */
  ariaLabel: string;
  visible: boolean;
}

// Словарь «стадия контракта → русский текст», park.md §3.2. Используется и для строки
// свежего факта, и для суффикса «Последний факт: …» устаревшего (stale не теряет стадию).
const STAGE_LABEL: Record<FirmwarePilotStage, string> = {
  not_started: "не начат",
  building: "сборка",
  burn_in: "обкатка",
  ready: "готово",
  stopped: "остановлено",
};

function formatUpdatedAt(updatedAt: string): string {
  return new Date(updatedAt).toLocaleString("ru-RU");
}

function noDataInfo(model: string): PilotInfo {
  return {
    label: "Пилот прошивки: нет данных о пилоте",
    secondLine: null,
    hint: "Fleet пока не опубликовал подтверждённый статус пилота для этой модели.",
    tone: "dim",
    ariaLabel: `Пилот прошивки ${model}: нет данных о пилоте`,
    visible: false,
  };
}

type ReportedStatus = Extract<FirmwarePilotStatus, { status: "reported" }>;

function staleInfo(status: ReportedStatus, model: string): PilotInfo {
  const stageLabel = STAGE_LABEL[status.stage];
  const date = formatUpdatedAt(status.updated_at);
  return {
    label: "Пилот прошивки: данные устарели",
    secondLine: `Последний факт: ${stageLabel}, обновлено ${date}`,
    hint: "Последний подтверждённый статус пилота устарел; текущий этап не показываем.",
    tone: "warn",
    ariaLabel: `Пилот прошивки ${model}: данные устарели. Последний факт — ${stageLabel}, обновлён ${date}`,
    visible: true,
  };
}

function stoppedInfo(status: ReportedStatus, model: string): PilotInfo {
  const date = formatUpdatedAt(status.updated_at);
  return {
    label: "Пилот прошивки: остановлено",
    secondLine: null,
    hint: "Пилот остановлен Fleet; это не влияет на готовность прошивки для модели.",
    tone: "warn",
    ariaLabel: `Пилот прошивки ${model}: остановлено, данные обновлены ${date}`,
    visible: true,
  };
}

function freshInfo(status: ReportedStatus, model: string): PilotInfo {
  const stageLabel = STAGE_LABEL[status.stage];
  const date = formatUpdatedAt(status.updated_at);
  const ariaStage = status.stage === "ready" ? "готово, подтверждено" : stageLabel;
  return {
    label: `Пилот прошивки: ${stageLabel}`,
    secondLine: null,
    hint: "Статус подтверждён Fleet. Он не изменяет готовность прошивки для модели.",
    tone: "dim",
    ariaLabel: `Пилот прошивки ${model}: ${ariaStage}, данные обновлены ${date}`,
    visible: true,
  };
}

// Единственный источник статуса — `FirmwarePilotStatus` из HTTP-контракта. Отсутствие поля
// во время rollout эквивалентно `no_data`; актуальность вычисляет producer, не браузер.
// `model` — имя модели (`printer.model`/`UserPrinter.model`, напр. «Ender-3 V3 KE», «V400»),
// входит в доступное имя строки по таблицам park.md §3.2/§3.3 — KE и V400 не должны звучать
// одинаково для скринридера.
export function pilotInfoFor(status: FirmwarePilotStatus | undefined, model: string): PilotInfo {
  if (!status || status.status === "no_data") return noDataInfo(model);
  // Контракт разрешает `stage="ready"` только с `confidence="verified"` (packages/contracts/http/
  // devices.ts); TS это гарантирует на входе, но реальный payload идёт через API без runtime-
  // валидации на этом пути (printerdetailscreen.tsx читает `printer.pilot_status` напрямую) —
  // невалидная комбинация не звучит как готовность, а трактуется как отсутствие данных (§3.3, MF-1869).
  if (status.stage === "ready" && status.confidence !== "verified") return noDataInfo(model);
  if (status.freshness === "stale") return staleInfo(status, model);
  if (status.stage === "stopped") return stoppedInfo(status, model);
  return freshInfo(status, model);
}
