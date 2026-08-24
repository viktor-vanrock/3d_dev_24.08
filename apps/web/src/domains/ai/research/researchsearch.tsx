import { useEffect, useRef, useState } from "react";
import { navigate, researchFormPath, researchNewPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { searchResearchPrinters, type ResearchSearchHit } from "./api.ts";
import { StatusChip } from "./researchrow.tsx";

// Поиск = кнопка создания (§1.3): голой «Создать карточку» на экране нет — последняя строка
// живой выдачи всегда «+ Создать карточку "…"», это единственный путь заведения новой карточки
// (главный источник дублей иначе). Debounce 250мс — тот же интервал, что дедуп идей (ideas.md §4.2)
// и живой поиск принтера в мастере парка (home/printerpicker.tsx).
const SEARCH_DEBOUNCE_MS = 250;

export function ResearchSearchCreate() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResearchSearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sound = useInteractionSound();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    debounceRef.current = setTimeout(() => {
      searchResearchPrinters(trimmed, controller.signal).then((hits) => setResults(hits ?? []));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [query]);

  // Закрытие панели по клику снаружи — тот же паттерн, что Popover-триггеры капсулы шапки.
  useEffect(() => {
    function onDocPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, []);

  const trimmed = query.trim();
  const showPanel = open && trimmed.length > 0;

  return (
    <div className="researchSearch" ref={rootRef}>
      <div className="marketSearchBar researchSearchBar">
        <SearchIcon />
        <input
          className="marketSearchInput"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Найти или создать карточку принтера…"
          aria-label="Найти или создать карточку принтера"
        />
      </div>
      {showPanel ? (
        <div className="researchSearchPanel">
          {results === null ? (
            <div className="researchSearchHint">Ищем…</div>
          ) : (
            results.map((hit) => (
              <button
                key={hit.slug}
                type="button"
                className="researchSearchHit pressable"
                onPointerDown={sound.tick}
                onClick={() => {
                  setOpen(false);
                  navigate(researchFormPath(hit.slug));
                }}
              >
                <span className="researchSearchHitTitle">
                  {hit.brand} · {hit.model}
                </span>
                <StatusChip status={hit.status} />
              </button>
            ))
          )}
          <button
            type="button"
            className="researchSearchCreate pressable"
            onPointerDown={sound.tick}
            onClick={() => {
              setOpen(false);
              navigate(researchNewPath(trimmed));
            }}
          >
            <PlusIcon />
            <span>Создать карточку «{trimmed}»</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
