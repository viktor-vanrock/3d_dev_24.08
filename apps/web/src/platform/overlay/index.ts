import {
  OverlayProvider,
  useOverlayContext,
  type AlertHandle,
  type AlertOptions,
  type ConfirmOptions,
  type ModalHandle,
  type ModalOptions,
  type NotificationApi,
  type NotificationInput,
  type SheetHandle,
  type SheetOptions,
  type ToastHandle,
  type ToastOptions,
} from "./provider.tsx";

/*
  Единственная точка импорта слоя всплывашек для экранов (docs/epics/overlay.system.md
  §4/§7). Экраны зовут только useOverlay() — никаких прямых createPortal,
  локальных useState('modalOpen') или самописных тостов на местах.
*/
export { OverlayProvider };
export type {
  AlertHandle,
  AlertOptions,
  ConfirmOptions,
  ModalHandle,
  ModalOptions,
  NotificationApi,
  NotificationInput,
  SheetHandle,
  SheetOptions,
  ToastHandle,
  ToastOptions,
};
export type { AlertActionItem, NotificationGroup, NotificationItem } from "./store.ts";

// Printer-alert публичная поверхность overlay (Этап 8): printerface стал recognized-доменом,
// entry-point требует импортировать platform только через index. Стадия 3 отложила это «до
// миграции printerface» — теперь она произошла. Потребители: printing/printerface,
// home/homeheader (последний ещё плоский, мигрирует на Этапе 4).
export { severityConfig, type Severity } from "./severity.ts";
export { playSound, type SoundKind } from "./sound.ts";
export { problemInfo, type PrinterProblem } from "./alert/reasons.ts";
export { severityFromPrinter, mockPrinterStatusSource } from "./alert/severity-from-printer.ts";
export { usePrinterAlerts } from "./alert/alerthost.tsx";
export { NotificationCenterList } from "./notifications/center.tsx";

export interface OverlayApi {
  toast(options: ToastOptions): ToastHandle;
  confirm(options: ConfirmOptions): Promise<boolean>;
  modal(options: ModalOptions): ModalHandle;
  sheet(options: SheetOptions): SheetHandle;
  alert(options: AlertOptions): AlertHandle;
  notifications: NotificationApi;
}

export function useOverlay(): OverlayApi {
  const { toast, confirm, modal, sheet, alert, notifications } = useOverlayContext();
  return { toast, confirm, modal, sheet, alert, notifications };
}
