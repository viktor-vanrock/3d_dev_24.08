import { useEffect, useRef, useState } from "react";
import { useOverlayContext } from "../provider.tsx";
import { severityConfig, type Severity } from "../severity.ts";
import type { AlertItem } from "../store.ts";
import { problemInfo } from "./reasons.ts";
import { severityFromPrinter, type PrinterStatus, type PrinterStatusSource } from "./severity-from-printer.ts";

/*
  Алерт-хост печати (docs/epics/overlay.system.md §4/§6, MF-442), слой 75
  (--z-alert, выше тостов/шитов/модалок — критичное видно поверх всего). Дедуп и
  сортировка по severity уже сделаны стором (store.ts ALERT_UPSERT); здесь только
  рендер + автозакрытие при восстановлении (usePrinterAlerts).
*/

const REEVALUATE_INTERVAL_MS = 15_000;

export type PrinterAlertAction = "pause" | "stop" | "details";

// Подписывает PrinterStatusSource на alert()/dismiss слоя всплывашек: маппит
// проблему в severity (с эскалацией по времени), дедуп по printerId делает стор.
// onAction — точка интеграции с деталью принтера/командами (MF-26 ещё не поднят,
// поэтому по умолчанию действие no-op с предупреждением в консоль для отладки).
export function usePrinterAlerts(
  source: PrinterStatusSource,
  onAction: (printerId: string, action: PrinterAlertAction) => void = defaultOnAction,
): { printingCount: number } {
  const { alert, dispatch } = useOverlayContext();
  const [statuses, setStatuses] = useState<PrinterStatus[]>([]);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => source.subscribe(setStatuses), [source]);

  // Кэш последней отданной severity на принтер — чтобы не долбить ALERT_UPSERT
  // (и не сбрасывать createdAt карточки) на каждый 15с-тик, если severity не
  // изменилась; дедуп в сторе всё равно по printerId, это только про лишний рендер.
  const lastSeverityRef = useRef(new Map<string, Severity>());

  useEffect(() => {
    function sync() {
      const now = Date.now();
      for (const status of statuses) {
        if (!status.problem) continue;
        const severity = severityFromPrinter(status.problem, now - status.since);
        if (lastSeverityRef.current.get(status.printerId) === severity) continue;
        lastSeverityRef.current.set(status.printerId, severity);
        const info = problemInfo(status.problem);
        alert({
          severity,
          printerId: status.printerId,
          what: `${status.printerName}: ${info.what}`,
          why: info.why,
          actions: [
            { label: "Пауза", onAction: () => onActionRef.current(status.printerId, "pause") },
            { label: "Стоп", onAction: () => onActionRef.current(status.printerId, "stop") },
            { label: "Разобраться", onAction: () => onActionRef.current(status.printerId, "details") },
          ],
        });
      }
    }
    sync();
    // Периодический пересчёт нужен только для эскалации warn→critical по времени
    // без нового события статуса (§6 спеки); чаще порога эскалации незачем.
    const timer = setInterval(sync, REEVALUATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [statuses, alert]);

  // Автозакрытие при восстановлении: как только problem обнулился, снимаем алерт.
  const previousProblemPrinters = useRef(new Set<string>());
  useEffect(() => {
    const nowProblem = new Set(statuses.filter((status) => status.problem).map((status) => status.printerId));
    for (const printerId of previousProblemPrinters.current) {
      if (!nowProblem.has(printerId)) {
        dispatch({ type: "ALERT_DISMISS", printerId });
        lastSeverityRef.current.delete(printerId);
      }
    }
    previousProblemPrinters.current = nowProblem;
  }, [statuses, dispatch]);

  const printingCount = statuses.filter((status) => !status.problem).length;
  return { printingCount };
}

function defaultOnAction(printerId: string, action: PrinterAlertAction): void {
  console.warn(`[alert] ${action} → ${printerId} (действие не подключено, см. usePrinterAlerts)`);
}

export function AlertHost() {
  const { state } = useOverlayContext();
  if (state.alerts.length === 0) return null;

  return (
    <div className="ovlAlertHost" data-testid="overlay-alert-host">
      {state.alerts.map((item) => (
        <AlertCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function AlertCard({ item }: { item: AlertItem }) {
  const { dispatch } = useOverlayContext();
  const config = severityConfig(item.severity);
  // Триггер появления через setTimeout, не rAF (motion.md — rAF стоит на паузе в фоне).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => dispatch({ type: "ALERT_DISMISS", printerId: item.printerId });

  return (
    <div
      className="ovlAlert modal-in-out pressable"
      data-severity={item.severity}
      data-visible={entered || undefined}
      data-pulse={config.pulse || undefined}
      role={config.role}
    >
      <span className="ovlAlertDot" aria-hidden="true" />
      <span className="ovlAlertBody">
        <span className="ovlAlertWhat">{item.what}</span>
        {item.why ? <span className="ovlAlertWhy">{item.why}</span> : null}
        {item.actions.length > 0 ? (
          <span className="ovlAlertActions">
            {item.actions.map((action) => (
              <button key={action.label} type="button" className="ovlAlertAction pressable" onClick={action.onAction}>
                {action.label}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <button type="button" className="ovlAlertClose pressable" aria-label="Скрыть алерт" onClick={dismiss}>
        ✕
      </button>
    </div>
  );
}

// Приглушённая сводка «печатают N» (§ «Всё ок» не шумит) — обычный текст в шапке,
// НЕ часть AlertHost/слоя внимания: без пульса/звука/z-alert, поэтому не считается
// attention-элементом. Рендерится только когда нет активных алертов (см. usage).
export function PrintSummaryPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ovlPrintSummary" data-testid="print-summary-pill">
      Печатают {count}
    </span>
  );
}
