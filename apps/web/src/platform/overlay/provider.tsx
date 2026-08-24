import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { prefersReducedMotionNow } from "@platform/theme";
import { severityConfig, type Severity } from "./severity.ts";
import { playSound } from "./sound.ts";
import { playInteractionSound } from "@platform/sound";
import {
  defaultToastDuration,
  initialOverlayState,
  overlayReducer,
  type AlertActionItem,
  type ModalItem,
  type ModalSize,
  type NotificationGroup,
  type NotificationItem,
  type OverlayAction,
  type OverlayState,
  type ToastAction,
} from "./store.ts";
import { OverlayPortal } from "./portal.tsx";

// Персист (§5 спеки, неймспейс portal.overlay.*, паттерн — theme/theme.tsx STORAGE_KEY):
// mute-тумблер и метка «прочитано до», не весь список уведомлений (это runtime-состояние).
const MUTE_KEY = "portal.overlay.muted";
const READ_AT_KEY = "portal.overlay.notificationsReadAt";

// Дефолт mute = уважает prefers-reduced-motion (§6 спеки «дефолт=reduce»), пока юзер
// явно не переключил тумблер сам (тогда сохранённое значение — источник правды).
function initialMuted(): boolean {
  const stored = localStorage.getItem(MUTE_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return prefersReducedMotionNow();
}

function initialReadAt(): number {
  return Number(localStorage.getItem(READ_AT_KEY)) || 0;
}

/*
  Провайдер слоя всплывашек (docs/epics/overlay.system.md §4-5): один наверху дерева
  (app.tsx, рядом с ThemeProvider), один портал в document.body. Экраны никогда
  не импортируют этот файл напрямую — только overlay/index.ts (useOverlay()).
*/

export interface ToastOptions {
  severity?: Severity;
  title: string;
  message?: string;
  duration?: number | "sticky";
  action?: ToastAction;
}

export interface ToastHandle {
  dismiss(): void;
  update(patch: Partial<ToastOptions>): void;
}

export interface ConfirmOptions {
  severity?: Severity;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ModalOptions {
  severity?: Severity;
  size?: ModalSize;
  title?: string;
  message?: string;
  content: ReactNode;
  onClose?: () => void;
}

export interface ModalHandle {
  close(): void;
}

export interface SheetOptions {
  title?: string;
  content: ReactNode;
  onClose?: () => void;
}

export interface SheetHandle {
  close(): void;
}

// Алерт печати (MF-442): severity ограничена warn|critical — info/success не «ломаются»,
// для них есть toast(). printerId — дедуп-ключ (§5 спеки): повторный вызов с тем же
// printerId заменяет предыдущий алерт вместо накопления дублей.
export interface AlertOptions {
  severity: Extract<Severity, "warn" | "critical">;
  printerId: string;
  what: string;
  why?: string;
  actions: AlertActionItem[];
}

export interface AlertHandle {
  dismiss(): void;
}

// Центр уведомлений (MF-443): notify() — общая точка входа для «система»/«сообщения»
// (печать заполняется автоматически из alert(), см. ниже). id — опциональный дедуп-ключ
// (повторный notify() с тем же id — no-op, см. store.ts NOTIFICATION_ADD).
export interface NotificationInput {
  group: NotificationGroup;
  severity: Severity;
  title: string;
  message?: string;
  deepLink?: string;
  id?: string;
}

export interface NotificationApi {
  items: NotificationItem[];
  unreadCount: number;
  notify(input: NotificationInput): void;
  markAllRead(): void;
  muted: boolean;
  setMuted(muted: boolean): void;
}

export interface OverlayContextValue {
  state: OverlayState;
  dispatch: (action: OverlayAction) => void;
  toast: (options: ToastOptions) => ToastHandle;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  modal: (options: ModalOptions) => ModalHandle;
  sheet: (options: SheetOptions) => SheetHandle;
  alert: (options: AlertOptions) => AlertHandle;
  notifications: NotificationApi;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(overlayReducer, initialOverlayState, (base) => ({
    ...base,
    muted: initialMuted(),
    notificationsReadAt: initialReadAt(),
  }));

  // toast()/alert()/notify() — стабильные useCallback([]), но должны видеть свежий muted
  // на момент вызова; ref вместо добавления state.muted в deps (не пересоздавать колбэки
  // на каждый mute-тогл, тот же паттерн что onActionRef в alert/alerthost.tsx).
  const mutedRef = useRef(state.muted);
  mutedRef.current = state.muted;
  // alert() читает «активен ли уже алерт на этот printerId» синхронно на момент вызова —
  // тот же паттерн ref, что и mutedRef (иначе [] deps дают устаревший state.alerts).
  const alertsRef = useRef(state.alerts);
  alertsRef.current = state.alerts;
  // notify() должен САМ решить, дедуп это или нет, ДО проигрывания звука — иначе экран,
  // который вызывает notify() с одним и тем же id на каждом рендере/маунте (например
  // system-welcome), будет звенеть заново каждый раз, хотя запись в центре не меняется.
  const notificationsRef = useRef(state.notifications);
  notificationsRef.current = state.notifications;

  useEffect(() => {
    localStorage.setItem(MUTE_KEY, state.muted ? "1" : "0");
  }, [state.muted]);

  useEffect(() => {
    localStorage.setItem(READ_AT_KEY, String(state.notificationsReadAt));
  }, [state.notificationsReadAt]);

  const toast = useCallback((options: ToastOptions): ToastHandle => {
    const id = nextId("toast");
    const severity = options.severity ?? "info";
    dispatch({
      type: "TOAST_ADD",
      toast: {
        id,
        severity,
        title: options.title,
        message: options.message,
        duration: options.duration ?? defaultToastDuration(severity),
        action: options.action,
        createdAt: Date.now(),
      },
    });
    const sound = severityConfig(severity).sound;
    if (sound) playSound(sound, mutedRef.current);
    return {
      dismiss: () => dispatch({ type: "TOAST_REMOVE", id }),
      update: (patch) => dispatch({ type: "TOAST_UPDATE", id, patch }),
    };
  }, []);

  const modal = useCallback((options: ModalOptions): ModalHandle => {
    const id = nextId("modal");
    const item: ModalItem = {
      id,
      kind: "custom",
      severity: options.severity ?? "info",
      size: options.size ?? "compact",
      title: options.title,
      message: options.message,
      content: options.content,
      onClose: options.onClose,
      createdAt: Date.now(),
    };
    dispatch({ type: "MODAL_PUSH", modal: item });
    return { close: () => dispatch({ type: "MODAL_POP", id }) };
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const id = nextId("confirm");
      const item: ModalItem = {
        id,
        kind: "confirm",
        // Деструктив по умолчанию читается как critical (коралл-кнопка, §4 спеки)
        severity: options.severity ?? (options.destructive ? "critical" : "info"),
        size: "compact",
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? "Подтвердить",
        cancelLabel: options.cancelLabel ?? "Отмена",
        destructive: options.destructive ?? false,
        resolve: (value) => {
          // Подтверждение — явный жест пользователя, поэтому звучит в момент смены
          // состояния модалки; исход операции озвучивает вызывающий экран.
          if (value) playInteractionSound("confirm", mutedRef.current);
          resolve(value);
        },
        createdAt: Date.now(),
      };
      dispatch({ type: "MODAL_PUSH", modal: item });
    });
  }, []);

  const sheet = useCallback((options: SheetOptions): SheetHandle => {
    const id = nextId("sheet");
    dispatch({ type: "SHEET_OPEN", sheet: { id, title: options.title, content: options.content, onClose: options.onClose } });
    return { close: () => dispatch({ type: "SHEET_CLOSE" }) };
  }, []);

  const alert = useCallback((options: AlertOptions): AlertHandle => {
    // «Новый эпизод» = для этого printerId сейчас нет активного алерта — именно на этот
    // момент в центр уведомлений уходит одна запись (не на каждую эскалацию warn→critical
    // внутри одного и того же незакрытого алерта, см. store.ts NOTIFICATION_ADD дедуп по id).
    const isNewEpisode = !alertsRef.current.some((item) => item.printerId === options.printerId);
    // id = printerId-производный, но дедуп по printerId делает сам редьюсер (ALERT_UPSERT).
    dispatch({
      type: "ALERT_UPSERT",
      alert: {
        id: `alert-${options.printerId}`,
        printerId: options.printerId,
        severity: options.severity,
        what: options.what,
        why: options.why,
        actions: options.actions,
        createdAt: Date.now(),
      },
    });
    const sound = severityConfig(options.severity).sound;
    if (sound) playSound(sound, mutedRef.current);
    if (isNewEpisode) {
      dispatch({
        type: "NOTIFICATION_ADD",
        notification: {
          id: `notif-alert-${options.printerId}-${Date.now()}`,
          group: "print",
          severity: options.severity,
          title: options.what,
          message: options.why,
          createdAt: Date.now(),
        },
      });
    }
    return { dismiss: () => dispatch({ type: "ALERT_DISMISS", printerId: options.printerId }) };
  }, []);

  const notify = useCallback((input: NotificationInput): void => {
    const id = input.id ?? nextId("notif");
    // Дедуп ДО звука — экраны вправе звать notify() с тем же id на каждом рендере
    // (например system-welcome в home.tsx), это не должно звенеть повторно.
    if (notificationsRef.current.some((item) => item.id === id)) return;
    dispatch({
      type: "NOTIFICATION_ADD",
      notification: {
        id,
        group: input.group,
        severity: input.severity,
        title: input.title,
        message: input.message,
        deepLink: input.deepLink,
        createdAt: Date.now(),
      },
    });
    const sound = severityConfig(input.severity).sound;
    if (sound) playSound(sound, mutedRef.current);
  }, []);

  const markAllRead = useCallback(() => {
    dispatch({ type: "NOTIFICATIONS_MARK_ALL_READ", at: Date.now() });
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    dispatch({ type: "MUTE_SET", muted });
  }, []);

  const notifications = useMemo<NotificationApi>(
    () => ({
      items: state.notifications,
      unreadCount: state.notifications.filter((item) => item.createdAt > state.notificationsReadAt).length,
      notify,
      markAllRead,
      muted: state.muted,
      setMuted,
    }),
    [state.notifications, state.notificationsReadAt, state.muted, notify, markAllRead, setMuted],
  );

  const value = useMemo<OverlayContextValue>(
    () => ({ state, dispatch, toast, confirm, modal, sheet, alert, notifications }),
    [state, toast, confirm, modal, sheet, alert, notifications],
  );

  return (
    <OverlayContext value={value}>
      {children}
      <OverlayPortal />
    </OverlayContext>
  );
}

export function useOverlayContext(): OverlayContextValue {
  const context = use(OverlayContext);
  if (!context) throw new Error("useOverlay используется вне OverlayProvider");
  return context;
}
