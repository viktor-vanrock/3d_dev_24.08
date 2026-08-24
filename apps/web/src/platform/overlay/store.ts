import type { ReactNode } from "react";
import type { Severity } from "./severity.ts";

/*
  Стор слоя всплывашек (docs/epics/overlay.system.md §5): один useReducer+Context,
  без внешних либ (zustand/redux не тянем). Держит очередь тостов (≤2 видимых,
  остальные ждут), стек модалок (глубина 1) и открытый шит. Алерты печати/лента
  уведомлений — MF-442/MF-443, здесь только контракт стора не расширяем заранее.
*/

export const MAX_VISIBLE_TOASTS = 2;

// info/success — 4с, warn — 8с, critical — sticky (держится до действия), см. §4 спеки.
export function defaultToastDuration(severity: Severity): number | "sticky" {
  switch (severity) {
    case "critical":
      return "sticky";
    case "warn":
      return 8000;
    default:
      return 4000;
  }
}

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastItem {
  id: string;
  severity: Severity;
  title: string;
  message?: string;
  duration: number | "sticky";
  action?: ToastAction;
  createdAt: number;
}

export interface ModalItemBase {
  id: string;
  severity: Severity;
  size: ModalSize;
  title?: string;
  message?: string;
  createdAt: number;
}

// Один шаблон панелей с тремя заранее проверенными ширинами: compact — короткие
// подтверждения, form — выбор/редактирование сущности, wide — многострочные формы.
// Новые размеры добавляются только после повторного сценария, а не локальным CSS экрана.
export type ModalSize = "compact" | "form" | "wide";

// Произвольное содержимое (modal()) или да/нет-диалог (confirm()) — одна очередь,
// но confirm хранит resolve, чтобы вызывающий получил Promise<boolean>.
export type ModalItem =
  | (ModalItemBase & { kind: "custom"; content: ReactNode; onClose?: () => void })
  | (ModalItemBase & {
      kind: "confirm";
      confirmLabel: string;
      cancelLabel: string;
      destructive: boolean;
      resolve: (value: boolean) => void;
    });

export interface SheetItem {
  id: string;
  title?: string;
  content: ReactNode;
  onClose?: () => void;
}

export interface AlertActionItem {
  label: string;
  onAction: () => void;
}

// Алерт печати (MF-442, docs/epics/overlay.system.md §4/§6): дедуп-ключ — printerId,
// повторный alert() с тем же printerId заменяет предыдущий, а не копит дубли.
export interface AlertItem {
  id: string;
  printerId: string;
  severity: Extract<Severity, "warn" | "critical">;
  what: string;
  why?: string;
  actions: AlertActionItem[];
  createdAt: number;
}

// Центр уведомлений (MF-443, docs/epics/overlay.system.md §6): группы печать/сообщения(MF-38)/
// система. Прочитанность не хранится по id — «открытие центра гасит бейдж» реализовано как
// метка времени notificationsReadAt (провайдер), непрочитанное = createdAt > notificationsReadAt.
export type NotificationGroup = "print" | "messages" | "system";

export interface NotificationItem {
  id: string;
  group: NotificationGroup;
  severity: Severity;
  title: string;
  message?: string;
  deepLink?: string;
  createdAt: number;
}

export const MAX_NOTIFICATIONS = 50;

export interface OverlayState {
  toastQueue: ToastItem[];
  modalQueue: ModalItem[];
  sheet: SheetItem | null;
  alerts: AlertItem[];
  notifications: NotificationItem[];
  notificationsReadAt: number;
  muted: boolean;
}

export const initialOverlayState: OverlayState = {
  toastQueue: [],
  modalQueue: [],
  sheet: null,
  alerts: [],
  notifications: [],
  notificationsReadAt: 0,
  muted: false,
};

export type OverlayAction =
  | { type: "TOAST_ADD"; toast: ToastItem }
  | { type: "TOAST_REMOVE"; id: string }
  | { type: "TOAST_UPDATE"; id: string; patch: Partial<Omit<ToastItem, "id" | "createdAt">> }
  | { type: "MODAL_PUSH"; modal: ModalItem }
  | { type: "MODAL_POP"; id: string }
  | { type: "SHEET_OPEN"; sheet: SheetItem }
  | { type: "SHEET_CLOSE" }
  | { type: "ALERT_UPSERT"; alert: AlertItem }
  | { type: "ALERT_DISMISS"; printerId: string }
  | { type: "NOTIFICATION_ADD"; notification: NotificationItem }
  | { type: "NOTIFICATIONS_MARK_ALL_READ"; at: number }
  | { type: "MUTE_SET"; muted: boolean };

// Критичное вытесняет менее срочное вперёд очереди, но ничего не удаляет
// (§4 спеки); сортировка стабильна — при равном приоритете порядок вставки сохраняется.
function sortByPriority(queue: ToastItem[]): ToastItem[] {
  return [...queue].sort((a, b) => {
    const priorityDiff = SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity];
    if (priorityDiff !== 0) return priorityDiff;
    return a.createdAt - b.createdAt;
  });
}

// Локальная копия приоритетов (без импорта конфига целиком — переносить сюда
// пересчёт цвета/звука/роли не нужно, это ответственность severity.ts).
const SEVERITY_PRIORITY: Record<Severity, number> = { info: 0, success: 1, warn: 2, critical: 3 };

// critical всегда выше warn; при равной серьёзности — порядок появления (стабильно).
function sortAlerts(alerts: AlertItem[]): AlertItem[] {
  return [...alerts].sort((a, b) => {
    const priorityDiff = SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity];
    if (priorityDiff !== 0) return priorityDiff;
    return a.createdAt - b.createdAt;
  });
}

export function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case "TOAST_ADD":
      return { ...state, toastQueue: sortByPriority([...state.toastQueue, action.toast]) };
    case "TOAST_REMOVE":
      return { ...state, toastQueue: state.toastQueue.filter((toast) => toast.id !== action.id) };
    case "TOAST_UPDATE":
      return {
        ...state,
        toastQueue: state.toastQueue.map((toast) =>
          toast.id === action.id ? { ...toast, ...action.patch } : toast,
        ),
      };
    case "MODAL_PUSH":
      return { ...state, modalQueue: [...state.modalQueue, action.modal] };
    case "MODAL_POP":
      return { ...state, modalQueue: state.modalQueue.filter((modal) => modal.id !== action.id) };
    case "SHEET_OPEN":
      return { ...state, sheet: action.sheet };
    case "SHEET_CLOSE":
      return { ...state, sheet: null };
    case "ALERT_UPSERT":
      return {
        ...state,
        alerts: sortAlerts([...state.alerts.filter((alert) => alert.printerId !== action.alert.printerId), action.alert]),
      };
    case "ALERT_DISMISS":
      return { ...state, alerts: state.alerts.filter((alert) => alert.printerId !== action.printerId) };
    case "NOTIFICATION_ADD":
      // Дедуп по id — источники (alert()/notify()) сами решают, что считать «тем же
      // событием» (например notif-alert-<printerId> не плодится заново на эскалации).
      if (state.notifications.some((item) => item.id === action.notification.id)) return state;
      return { ...state, notifications: [action.notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS) };
    case "NOTIFICATIONS_MARK_ALL_READ":
      return { ...state, notificationsReadAt: action.at };
    case "MUTE_SET":
      return { ...state, muted: action.muted };
    default:
      return state;
  }
}
