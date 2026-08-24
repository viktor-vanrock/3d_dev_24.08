import { useState } from "react";
import "./research.css";

// Панель «Источники» (§2.6): нумерация [1][2][3], домен вместо сырого URL, тихий индикатор
// активного источника (мятная точка, БЕЗ текста «активен» — фоновая индикация, не жест, §4
// таблица моушена). Один компонент для desktop-sticky и mobile-accordion — раскладку решает
// обёртка вызывающей стороны (researchform.tsx), сам список идентичен в обоих местах (§3
// «сноски работают идентично»).

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface SourcesPanelProps {
  sources: string[];
  activeSourceIndex: number | null;
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
  onSetActive: (index: number) => void;
}

export function SourcesPanel({ sources, activeSourceIndex, onAdd, onRemove, onSetActive }: SourcesPanelProps) {
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft("");
  }

  return (
    <div className="rsSources">
      {sources.length === 0 ? <p className="rsSourcesEmpty">Пока без источников — карточка сохранится черновиком</p> : null}
      <ul className="rsSourceList">
        {sources.map((url, index) => (
          <li key={`${url}-${index}`} className="rsSourceRow" data-active={index === activeSourceIndex || undefined}>
            <span className="rsSourceDot" aria-hidden="true" />
            <button type="button" className="rsSourceNumber pressable" onClick={() => onSetActive(index)} aria-label={`Сделать источник ${index + 1} активным`}>
              [{index + 1}]
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" className="rsSourceDomain" title={url}>
              {domainOf(url)} <ExternalIcon />
            </a>
            <button type="button" className="rsSourceRemove pressable" onClick={() => onRemove(index)} aria-label={`Удалить источник ${index + 1}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="rsSourceAdd">
        <input
          className="rsInput"
          value={draft}
          placeholder="+ добавить URL"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      </div>
    </div>
  );
}
