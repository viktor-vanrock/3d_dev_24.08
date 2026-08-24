import { useEffect, useRef, useState } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { listModels, listTagsWithCounts, type MarketModel, type ModelSort, type TagWithCount } from "@domains/commerce";
import { mergePublishedShowcase } from "./publishedshowcase.ts";

// Единый store «поиск+фильтры» (MF-512, docs/design/projects.page.md §3.1): поиск и сайдбар
// оба читают/пишут это состояние, выдача — производная (store → fetch → grid). Любой будущий
// писатель (v2 AI-агент поиска, §3.3) подключается тем же путём — setQ/toggleTag — без
// переписывания связки. Deep-link (§3.2): весь catalogQuery сериализуется в URL двусторонне.

const DEBOUNCE_MS = 350;
const PAGE_SIZE = 24;

function readInitialQuery(): { q: string; sort: ModelSort; tags: string[]; fitMine: boolean } {
  const params = new URLSearchParams(window.location.search);
  return {
    // `/market?search=` — совместимый публичный deep-link (MF-1630); новые ссылки используют `q`.
    q: params.get("q") ?? params.get("search") ?? "",
    sort: params.get("sort") === "popular" ? "popular" : "new",
    tags: params.getAll("tag").filter(Boolean),
    fitMine: params.get("fit") === "mine",
  };
}

export interface CatalogStore {
  q: string;
  sort: ModelSort;
  tags: string[];
  fitMine: boolean;
  setQ: (q: string) => void;
  setSort: (sort: ModelSort) => void;
  setFitMine: (fitMine: boolean) => void;
  toggleTag: (tag: string) => void;
  selectPopularTag: (tag: string) => void;
  reset: () => void;
  filtersActive: boolean;
  availableTags: TagWithCount[];
  models: MarketModel[] | null;
  hasMore: boolean;
  loadError: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  // Pull-to-refresh (touch.nav.md §3): перезапрашивает страницу 1 с текущими фильтрами, тем же
  // запросом, что и обычный fetch-эффект ниже — возвращает промис, чтобы жест дождался ответа
  // перед success-вспышкой.
  refresh: () => Promise<void>;
}

export function useCatalogQuery(): CatalogStore {
  const initial = useRef(readInitialQuery()).current;
  const [q, setQ] = useState(initial.q);
  const [debouncedQ, setDebouncedQ] = useState(initial.q);
  const [sort, setSort] = useState<ModelSort>(initial.sort);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [fitMine, setFitMine] = useState(initial.fitMine);
  const [availableTags, setAvailableTags] = useState<TagWithCount[]>([]);
  const [models, setModels] = useState<MarketModel[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const modelsRef = useRef<MarketModel[] | null>(null);
  modelsRef.current = models;
  // Курсор keyset-пагинации (MF-603): значение из ответа сервера, передаём как есть в loadMore.
  const nextCursorRef = useRef<string | null>(null);

  // Back/Forward меняют адрес раньше popstate, а переходы SPA шлют locationchange из router.ts.
  // В обоих случаях URL остаётся источником правды для поисковой строки и фильтров.
  useEffect(() => {
    const syncFromLocation = () => {
      const next = readInitialQuery();
      setQ(next.q);
      setDebouncedQ(next.q);
      setSort(next.sort);
      setTags(next.tags);
      setFitMine(next.fitMine);
    };
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("locationchange", syncFromLocation);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("locationchange", syncFromLocation);
    };
  }, []);

  // Живое обновление (§3.2): дебаунс на ввод в поиске, сама выдача — сразу на смену фильтров.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    void listTagsWithCounts().then(setAvailableTags);
  }, []);

  const filtersKey = `${debouncedQ}|${sort}|${tags.join(",")}`;

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    void listModels({
      limit: PAGE_SIZE,
      q: debouncedQ || undefined,
      sort,
      tag: tags.length > 0 ? tags : undefined,
    }).then((result) => {
      if (cancelled) return;
      if (!result) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setModels(mergePublishedShowcase(result.models, { q: debouncedQ, tags }));
      setHasMore(result.has_more);
      nextCursorRef.current = result.next_cursor;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  // Deep-link (§3.2): весь catalogQuery — в URL, двусторонне. replaceState — фильтр/поиск не
  // должны плодить историю на каждый keystroke.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (debouncedQ) params.set("q", debouncedQ);
    else params.delete("q");
    if (sort !== "new") params.set("sort", sort);
    else params.delete("sort");
    params.delete("tag");
    for (const tag of tags) params.append("tag", tag);
    if (fitMine) params.set("fit", "mine");
    else params.delete("fit");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [debouncedQ, sort, tags, fitMine]);

  async function loadMore() {
    const current = modelsRef.current;
    if (!current || loadingMore) return;
    setLoadingMore(true);
    const result = await listModels({
      limit: PAGE_SIZE,
      cursor: nextCursorRef.current ?? undefined,
      q: debouncedQ || undefined,
      sort,
      tag: tags.length > 0 ? tags : undefined,
    });
    setLoadingMore(false);
    if (!result) return;
    setModels((prev) => (prev ? [...prev, ...result.models] : result.models));
    setHasMore(result.has_more);
    nextCursorRef.current = result.next_cursor;
  }

  async function refresh() {
    const result = await listModels({
      limit: PAGE_SIZE,
      q: debouncedQ || undefined,
      sort,
      tag: tags.length > 0 ? tags : undefined,
    });
    if (!result) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setModels(mergePublishedShowcase(result.models, { q: debouncedQ, tags }));
    setHasMore(result.has_more);
    nextCursorRef.current = result.next_cursor;
  }

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  }

  function selectPopularTag(tag: string) {
    // Популярный запрос — самостоятельная точка входа, а не второй AND-фильтр к старому
    // запросу. Это делает выдачу предсказуемой и не оставляет пользователя в ложном нуле.
    setQ("");
    setDebouncedQ("");
    setTags((current) => (current.length === 1 && current[0] === tag ? [] : [tag]));
  }

  return {
    q,
    sort,
    tags,
    fitMine,
    setQ,
    setSort,
    setFitMine,
    toggleTag,
    selectPopularTag,
    reset: () => {
      setQ("");
      setTags([]);
      setFitMine(false);
    },
    filtersActive: q.length > 0 || tags.length > 0 || fitMine,
    availableTags,
    models,
    hasMore,
    loadError,
    loadingMore,
    loadMore: () => void loadMore(),
    refresh,
  };
}
