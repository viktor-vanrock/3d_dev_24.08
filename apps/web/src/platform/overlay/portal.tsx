import { createPortal } from "react-dom";
import { OverlayToaster } from "./toaster.tsx";
import { OverlayModalHost } from "./modal.tsx";
import { OverlaySheetHost } from "./sheet.tsx";
import { AlertHost } from "./alert/alerthost.tsx";
import "./overlay.css";

/*
  Единый портал слоя всплывашек (docs/epics/overlay.system.md §4): один на всё
  приложение, монтируется провайдером в document.body. Не раздвигает контент
  (docs/design/readme.md §Философия п.4) — position: fixed, pointer-events включаются
  точечно на самих карточках/модалках/шитах (см. overlay.css). AlertHost — верхний
  слой (--z-alert=75, MF-442): критичный алерт печати виден поверх модалок.
*/
export function OverlayPortal() {
  return createPortal(
    <div className="ovlHost" aria-live="polite">
      <OverlayToaster />
      <OverlaySheetHost />
      <OverlayModalHost />
      <AlertHost />
    </div>,
    document.body,
  );
}
