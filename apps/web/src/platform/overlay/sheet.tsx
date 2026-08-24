import { useEffect, useRef, useState } from "react";
import { useOverlayContext } from "./provider.tsx";

/*
  Правая панель/шит (docs/epics/overlay.system.md §4/§6, MF-441): несрочный контекст,
  выезжает справа, всегда закрывается по фону/Esc (severity к шиту не относится —
  это не алерт, а вспомогательная панель). Один шит одновременно (store.ts).
*/
export function OverlaySheetHost() {
  const { state, dispatch } = useOverlayContext();
  const item = state.sheet;
  const panelRef = useRef<HTMLDivElement>(null);
  // Enter — примитив .modal-in-out (motion.md «Примитивы»). Триггер появления —
  // setTimeout, не rAF (rAF стоит на паузе в фоне → застрянет opacity:0).
  const [entered, setEntered] = useState(false);

  const close = () => {
    item?.onClose?.();
    dispatch({ type: "SHEET_CLOSE" });
  };

  useEffect(() => {
    if (!item) return;
    setEntered(false);
    const enterTimer = setTimeout(() => setEntered(true), 10);
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(enterTimer);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return null;

  return (
    <div
      className="ovlSheetBackdrop"
      data-testid="overlay-sheet-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={panelRef}
        className="ovlSheet modal-in-out"
        data-visible={entered || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        tabIndex={-1}
      >
        <div className="ovlSheetHead">
          {item.title ? <div className="ovlModalTitle">{item.title}</div> : <span />}
          <button type="button" className="ovlModalClose pressable" aria-label="Закрыть" onClick={close}>
            ✕
          </button>
        </div>
        {item.content}
      </div>
    </div>
  );
}
