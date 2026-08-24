import { useEffect, useRef, useState } from "react";
import { useOverlayContext } from "./provider.tsx";
import { severityConfig } from "./severity.ts";
import type { ModalItem } from "./store.ts";

/*
  Модалки/confirm (docs/epics/overlay.system.md §4/§6, MF-441): фокус-трап, Esc/клик
  по фону закрывают (кроме critical — там только явное действие), затемнение,
  тач-таргеты ≥48px (theme/tokens.css .pressable), role по severity.
  Глубина очереди — 1: показываем верх стека, остальное ждёт (store.ts).
*/

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function OverlayModalHost() {
  const { state, dispatch } = useOverlayContext();
  const top = state.modalQueue[0];
  if (!top) return null;

  const closable = top.severity !== "critical";

  const close = () => {
    if (top.kind === "confirm") top.resolve(false);
    else top.onClose?.();
    dispatch({ type: "MODAL_POP", id: top.id });
  };

  const confirmYes = () => {
    if (top.kind !== "confirm") return;
    top.resolve(true);
    dispatch({ type: "MODAL_POP", id: top.id });
  };

  return (
    <div
      className="ovlModalBackdrop"
      data-testid="overlay-modal-backdrop"
      onPointerDown={(event) => {
        if (closable && event.target === event.currentTarget) close();
      }}
    >
      <ModalPanel item={top} closable={closable} onClose={close} onConfirm={top.kind === "confirm" ? confirmYes : undefined} />
    </div>
  );
}

function ModalPanel({
  item,
  closable,
  onClose,
  onConfirm,
}: {
  item: ModalItem;
  closable: boolean;
  onClose: () => void;
  onConfirm?: () => void;
}) {
  const config = severityConfig(item.severity);
  const frameRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Enter — примитив .modal-in-out (motion.md «Примитивы»). Триггер появления —
  // setTimeout, не rAF (rAF стоит на паузе в фоне → застрянет opacity:0).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Фокус-трап: запоминаем предыдущий фокус, ставим фокус внутрь модалки,
  // Tab циклится по фокусируемым элементам, восстанавливаем фокус на закрытии.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const frame = frameRef.current;
    const firstFocusable = frame?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? frame)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (closable) onClose();
        return;
      }
      if (event.key !== "Tab" || !frame) return;
      const focusable = Array.from(frame.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closable]);

  return (
    <div ref={frameRef} className="ovlModalFrame" data-size={item.size}>
      <div
        className="ovlModal modal-in-out"
        data-visible={entered || undefined}
        data-severity={item.severity}
        data-size={item.size}
        data-pulse={config.pulse || undefined}
        role={item.severity === "critical" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={item.title}
        tabIndex={-1}
      >
        {item.title ? <div className="ovlModalTitle">{item.title}</div> : null}
        {item.message ? <div className="ovlModalMessage">{item.message}</div> : null}
        {item.kind === "custom" ? item.content : null}
        {item.kind === "confirm" ? (
          <div className="ovlModalActions">
            <button type="button" className="ovlModalCancel pressable" onClick={onClose}>
              {item.cancelLabel}
            </button>
            <button
              type="button"
              className="ovlModalConfirm pressable"
              data-destructive={item.destructive || undefined}
              onClick={onConfirm}
            >
              {item.confirmLabel}
            </button>
          </div>
        ) : null}
      </div>
      {closable ? (
        <button type="button" className="ovlModalClose pressable" aria-label="Закрыть" onClick={onClose}>
          ✕
        </button>
      ) : null}
    </div>
  );
}
