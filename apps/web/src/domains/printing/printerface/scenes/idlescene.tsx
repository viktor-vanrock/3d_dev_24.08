import { Eyebrow, Heading } from "@shared/ui";
import type { FaceState } from "../facesource.ts";

function PrintIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9V4h12v5M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-5A1.5 1.5 0 0 1 4.5 10h15A1.5 1.5 0 0 1 21 11.5v5a1.5 1.5 0 0 1-1.5 1.5H18M6 18v3h12v-3M6 18h12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 4v2.2M12 17.8V20M4 12h2.2M17.8 12H20M6.3 6.3l1.6 1.6M16.1 16.1l1.6 1.6M6.3 17.7l1.6-1.6M16.1 7.9l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Сцена (a) — простой/готов к печати (printer.face.md §2.3.a): один hero-заголовок + ряд из
// двух крупных карточек-действий внизу (layout.md «две карточки-действия», secondary слева/
// primary справа).
export function IdleScene({ state, onPrint, onSettings }: { state: FaceState; onPrint: () => void; onSettings: () => void }) {
  return (
    <div className="faceScene faceScene--idle reveal">
      <div className="faceSceneBody">
        <div className="faceHero">
          <Heading size="md" accent="печати">
            Готов к
          </Heading>
          <Eyebrow>
            {state.printerName} · {state.model}
          </Eyebrow>
        </div>
      </div>
      <div className="faceActionRow">
        <button type="button" className="faceActionCard pressable" data-variant="secondary" onClick={onSettings}>
          <span className="faceActionCardIcon" data-variant="secondary">
            <SettingsIcon />
          </span>
          <span className="faceActionCardTitle">Настройки</span>
        </button>
        <button type="button" className="faceActionCard pressable" data-variant="primary" onClick={onPrint}>
          <span className="faceActionCardIcon" data-variant="primary">
            <PrintIcon />
          </span>
          <span className="faceActionCardTitle">Напечатать</span>
        </button>
      </div>
    </div>
  );
}
