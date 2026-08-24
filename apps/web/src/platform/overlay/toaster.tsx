import { useEffect, useState } from "react";
import { useOverlayContext } from "./provider.tsx";
import { severityConfig } from "./severity.ts";
import { MAX_VISIBLE_TOASTS, type ToastItem } from "./store.ts";

/*
  Тосты (docs/epics/overlay.system.md §4/§6, MF-441): очередь ≤2 видимых одновременно,
  остальное ждёт (store.ts сортирует по severity-приоритету). Автоскрытие по
  severity (store.defaultToastDuration), critical — sticky, держится до действия.
*/
export function OverlayToaster() {
  const { state, dispatch } = useOverlayContext();
  const visible = state.toastQueue.slice(0, MAX_VISIBLE_TOASTS);

  return (
    <div className="ovlToaster" data-testid="overlay-toaster">
      {visible.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dispatch({ type: "TOAST_REMOVE", id: toast.id })} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const config = severityConfig(toast.severity);
  // Триггер появления — setTimeout, не rAF (грабля docs/design/motion.md: rAF на паузе
  // в фоне → элемент застрянет opacity:0).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (toast.duration === "sticky") return;
    const timer = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.duration, toast.id]);

  return (
    <div
      className="ovlToast modal-in-out pressable"
      data-severity={toast.severity}
      data-visible={entered || undefined}
      data-pulse={config.pulse || undefined}
      role={config.role}
    >
      {toast.severity === "success" ? (
        <span className="ovlToastIcon" aria-hidden="true" data-visible={entered || undefined}>
          <SuccessCheckIcon />
        </span>
      ) : (
        <span className="ovlToastDot" aria-hidden="true" />
      )}
      <span className="ovlToastBody">
        <span className="ovlToastTitle">{toast.title}</span>
        {toast.message ? <span className="ovlToastMessage">{toast.message}</span> : null}
      </span>
      {toast.action ? (
        <button
          type="button"
          className="ovlToastAction pressable"
          onClick={() => {
            toast.action?.onAction();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" className="ovlToastClose pressable" aria-label="Закрыть уведомление" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}

function SuccessCheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="var(--accent)" />
      <path
        className="ovlToastCheck"
        d="M7 12.5l3 3 7-7"
        stroke="var(--accent-contrast)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
