import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ASSISTANT_CONTEXT_SEARCH_EVENT, type AssistantContextSearchDetail } from "@domains/ai";
import { listModels, type MarketModel } from "@domains/commerce";
import { useInteractionSound } from "@platform/sound";
import { Coachmark } from "@shared/ui";
import type { ActiveCoachmark } from "@domains/onboarding";
import { CatIcon, ClearIcon, DragonIcon, HeadsetIcon, HookIcon, MoonIcon, PotIcon, SearchIcon, TrayIcon, VaseIcon } from "./home.icons.tsx";
import {
  buildPromptConcepts,
  listCachedConcepts,
  requestPromptConcepts,
  type ConceptCacheState,
  type PromptConceptState,
} from "./promptconcepts.ts";
import { trackActivation } from "@shared/lib";

// --- Единый discovery: проекты + постоянный RAG-кэш + новые концепты (MF-2067/MF-2068) ---

export type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; models: MarketModel[]; hasMore: boolean }
  | { kind: "error" };

const SEARCH_DEBOUNCE_MS = 120;
// Gemma остаётся приоритетным автором, если успевает ответить интерактивно. Медленный
// холодный слот не имеет права удерживать первый экран 10–15 секунд: через короткий
// soft-deadline показываем локальные содержательные варианты, а остальные источники
// (проекты и RAG-кэш) продолжают наполнять ту же сетку независимо.
const PROMPT_FAST_FALLBACK_MS = 450;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_RESULT_LIMIT = 10;

// Живой поиск (home.scenario.md §3.1/3.3): запрашиваем на одну модель больше видимого лимита,
// чтобы честно показать переход в полный каталог только когда результатов действительно >10.
// `?q=` синхронизируется в адрес через replaceState (не плодит историю на каждый символ) — заход
// назад с /generate или карточки модели восстанавливает и запрос, и найденное (HomeScreen
// перемонтируется на каждый заход на «/», начальное чтение query ниже отрабатывает снова).
export function useHomeSearch() {
  const [query, setQueryState] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [searchState, setSearchState] = useState<SearchState>({ kind: "idle" });
  const [promptState, setPromptState] = useState<PromptConceptState>({ kind: "idle", concepts: [] });
  const [cacheState, setCacheState] = useState<ConceptCacheState>({ kind: "idle", concepts: [] });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const onContextSearch = (event: Event) => {
      const detail = (event as CustomEvent<AssistantContextSearchDetail>).detail;
      if (detail?.context.kind === "home") setQuery(detail.query);
    };
    window.addEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, onContextSearch);
    return () => window.removeEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, onContextSearch);
  }, []);

  function runDiscovery(raw: string) {
    const trimmed = raw.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setSearchState({ kind: "idle" });
      setPromptState({ kind: "idle", concepts: [] });
      setCacheState({ kind: "idle", concepts: [] });
      return;
    }
    const requestId = ++requestIdRef.current;
    setSearchState({ kind: "loading" });
    setPromptState({ kind: "loading", concepts: [] });
    setCacheState({ kind: "loading", concepts: [] });
    const localFallback = buildPromptConcepts(trimmed);
    let promptCommitted = false;
    const promptFallbackTimer = window.setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      promptCommitted = true;
      setPromptState(
        localFallback.length > 0
          ? { kind: "ready", concepts: localFallback }
          : { kind: "error", concepts: [] },
      );
    }, PROMPT_FAST_FALLBACK_MS);

    // Три источника стартуют одним тиком и наполняют сетку независимо. Быстрый cache hit не
    // ждёт Gemma, а реальные проекты не ждут ANN — это и есть progressive discovery MF-2067.
    void listModels({ q: trimmed, limit: SEARCH_RESULT_LIMIT + 1 })
      .catch(() => null)
      .then((result) => {
        if (requestIdRef.current !== requestId) return; // ответ устарел — новый запрос уже в полёте
        if (result === null) {
          setSearchState({ kind: "error" });
          return;
        }
        setSearchState({
          kind: "results",
          models: result.models.slice(0, SEARCH_RESULT_LIMIT),
          hasMore: result.has_more || result.models.length > SEARCH_RESULT_LIMIT,
        });
      });
    void listCachedConcepts(trimmed).then((result) => {
      if (requestIdRef.current !== requestId) return;
      setCacheState(
        result
          ? {
              kind: "ready",
              concepts: result.concepts,
              degraded: result.degraded,
              nextCursor: result.nextCursor,
            }
          : { kind: "error", concepts: [] },
      );
    });
    void requestPromptConcepts(trimmed).then((concepts) => {
      if (requestIdRef.current !== requestId) return;
      // После soft-deadline карточки уже показаны и могли попасть в видимую GPU-очередь.
      // Поздняя замена всего набора создала бы второй job и визуальный скачок — такой ответ
      // Gemma используем уже в следующих scroll-батчах, но не переписываем первый экран.
      if (promptCommitted) return;
      promptCommitted = true;
      window.clearTimeout(promptFallbackTimer);
      const fallback = concepts ?? localFallback;
      setPromptState(
        fallback.length > 0
          ? { kind: "ready", concepts: fallback }
          : { kind: "error", concepts: [] },
      );
    });
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      requestIdRef.current++; // отменяет всё, что ещё в полёте
      setSearchState({ kind: "idle" });
      setPromptState({ kind: "idle", concepts: [] });
      if (trimmed.length > 0) {
        setCacheState({ kind: "idle", concepts: [] });
        return;
      }
      const requestId = requestIdRef.current;
      setCacheState({ kind: "loading", concepts: [] });
      void listCachedConcepts().then((result) => {
        if (requestIdRef.current !== requestId) return;
        setCacheState(
          result
            ? {
                kind: "ready",
                concepts: result.concepts,
                degraded: result.degraded,
                nextCursor: result.nextCursor,
              }
            : { kind: "error", concepts: [] },
        );
      });
      return;
    }
    const timer = window.setTimeout(() => runDiscovery(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  function setQuery(next: string) {
    // Инвалидируем старые ответы и состояния в том же React batch, что и новое значение
    // input. Иначе effect нового query успевал снова подхватить ready-cache предыдущего
    // запроса и держал его на экране до 12-секундного таймаута Gemma.
    requestIdRef.current += 1;
    setQueryState(next);
    if (next.trim().length >= SEARCH_MIN_LENGTH) {
      setSearchState({ kind: "loading" });
      setPromptState({ kind: "loading", concepts: [] });
      setCacheState({ kind: "loading", concepts: [] });
    } else {
      setSearchState({ kind: "idle" });
      setPromptState({ kind: "idle", concepts: [] });
      setCacheState({ kind: "idle", concepts: [] });
    }
    const url = new URL(window.location.href);
    if (next.trim()) url.searchParams.set("q", next);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  return {
    query,
    setQuery,
    searchState,
    promptState,
    cacheState,
    retry: () => runDiscovery(query),
  };
}

// Варианты запроса — компактные чипы с иконками (побольше вариантов, поменьше каждый)
const SEARCH_HINTS: { text: string; icon: ReactNode }[] = [
  { text: "котик в шлеме", icon: <CatIcon /> },
  { text: "ваза с узором", icon: <VaseIcon /> },
  { text: "органайзер", icon: <TrayIcon /> },
  { text: "крючок на стену", icon: <HookIcon /> },
  { text: "шарнирный дракон", icon: <DragonIcon /> },
  { text: "кашпо", icon: <PotIcon /> },
  { text: "держатель наушников", icon: <HeadsetIcon /> },
  { text: "лампа-луна", icon: <MoonIcon /> },
];

// Hero — один вход в общий discovery. Сама строка не рисует отдельный режим генерации:
// проекты, ready-концепты и постепенно готовящиеся новые изображения живут в одной сетке ниже.
export function HeroSearch({
  query,
  onQueryChange,
  coachmark,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  coachmark: ActiveCoachmark | null;
}) {
  const sound = useInteractionSound();

  const trimmed = query.trim();
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    // Первый символ — один из четырёх триггеров дисмисса коучмарка (§6).
    if (coachmark && query.length === 0 && next.length > 0) coachmark.dismiss();
    onQueryChange(next);
  }

  // Дисмисс по таймеру (8с бездействия) и по любому скроллу страницы (§6, ещё два из
  // четырёх независимых триггеров) — «Понятно» дисмиссит сама Coachmark ниже.
  useEffect(() => {
    if (!coachmark) return;
    const timer = window.setTimeout(() => coachmark.dismiss(), 8000);
    const onScroll = () => coachmark.dismiss();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [coachmark]);

  return (
    <section className="homeSearchHero">
      <div className="homeInputWrap" data-active={trimmed.length > 0 || undefined}>
        <span className="homeInputSearchIcon">
          <SearchIcon />
        </span>
        <input
          id="home-search-input"
          className="homeGhostInput"
          value={query}
          onChange={handleChange}
          placeholder="Найти или создать модель"
          aria-label="Найти или создать модель"
        />
        <button
          type="button"
          className="homeInputClear pressable"
          aria-label="Очистить"
          data-visible={query.length > 0 || undefined}
          onPointerDown={sound.tick}
          onClick={() => onQueryChange("")}
        >
          <ClearIcon />
        </button>
      </div>
      {coachmark ? <div className="homeSearchActions">
        <div className="homeCoachmarkAnchor">
          {coachmark ? <Coachmark title={coachmark.spec.title} onDismiss={coachmark.dismiss} /> : null}
        </div>
      </div> : null}
      {trimmed ? null : <div className="homeSearchChips stagger-reveal">
        {SEARCH_HINTS.map((hint, index) => (
          <button
            key={hint.text}
            type="button"
            className="homeHintChip pressable"
            style={{ ["--i" as string]: index }}
            onPointerDown={sound.tick}
            onClick={() => {
              trackActivation("home_hint_chip_click", { text: hint.text });
              onQueryChange(hint.text);
            }}
          >
            <span className="homeHintIcon">{hint.icon}</span>
            {hint.text}
          </button>
        ))}
      </div>}
    </section>
  );
}
