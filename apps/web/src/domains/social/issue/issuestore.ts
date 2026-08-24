import { useEffect, useRef, useState } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { listIdeas, type IdeaCategory, type IdeaListItem, type IdeaStatus, type IdeaTab } from "@domains/commerce";

// Единый store «табы + фильтры + выдача» ленты `/issue` (MF-945, docs/design/ideas.md §1.2):
// переиспользует механизм MF-508 (projects/catalogstore.ts useCatalogQuery) — тот же приём
// (дебаунс здесь не нужен, чипы/табы не набор текста; debounced-поиск живёт только в forme
// подачи §4.2, не в ленте), но собран заново, а не импортирован из catalogstore.ts: тот store
// завязан на MarketModel/listModels/тег-теги, а не на idea-специфичный tab/category/status —
// обобщать его под оба сразу означало бы протаскивать idea-поля в чужой файл ради одного
// потребителя (правка §Assumptions в финальном отчёте). Состояние — ровно
// `{tab, category, status, items, cursor, loading, error}` из спеки §1.2, плюс служебные поля
// пагинации/гостевого гейта, которых спека явно требует в §1.5/§1.6.

const PAGE_SIZE = 20;

function readInitialFilters(): { tab: IdeaTab; category?: IdeaCategory; status?: IdeaStatus } {
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get("tab");
  const tab: IdeaTab = tabParam === "new" || tabParam === "trending" ? tabParam : "popular";
  const catParam = params.get("cat");
  const category: IdeaCategory | undefined =
    catParam === "catalog" || catParam === "projects" || catParam === "forum" || catParam === "account" || catParam === "other" ? catParam : undefined;
  const statusParam = params.get("status");
  const status: IdeaStatus | undefined =
    statusParam === "under_review" ||
    statusParam === "planned" ||
    statusParam === "in_progress" ||
    statusParam === "done" ||
    statusParam === "declined"
      ? statusParam
      : undefined;
  return { tab, category, status };
}

export type IssueFeedErrorKind = "unauthorized" | "error" | null;

export interface IssueFeedStore {
  tab: IdeaTab;
  category?: IdeaCategory;
  status?: IdeaStatus;
  items: IdeaListItem[] | null;
  loading: boolean;
  error: IssueFeedErrorKind;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  filtersActive: boolean;
  setTab: (tab: IdeaTab) => void;
  setCategory: (category: IdeaCategory | undefined) => void;
  setStatus: (status: IdeaStatus | undefined) => void;
  reset: () => void;
  retry: () => void;
  loadMore: () => void;
}

export function useIssueFeed(): IssueFeedStore {
  const initial = useRef(readInitialFilters()).current;
  const [tab, setTab] = useState<IdeaTab>(initial.tab);
  const [category, setCategory] = useState<IdeaCategory | undefined>(initial.category);
  const [status, setStatus] = useState<IdeaStatus | undefined>(initial.status);
  const [items, setItems] = useState<IdeaListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<IssueFeedErrorKind>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const nextCursorRef = useRef<string | null>(null);
  const itemsRef = useRef<IdeaListItem[] | null>(null);
  itemsRef.current = items;

  const filtersKey = `${tab}|${category ?? ""}|${status ?? ""}`;

  // Смена таба/фильтра сбрасывает курсор и перезапрашивает (§1.2 «любой контрол — сбрасывает
  // курсор и перезапрашивает GET /ideas»).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems(null);
    setError(null);
    setLoadMoreError(false);
    void listIdeas({ tab, category, status, limit: PAGE_SIZE }).then((outcome) => {
      if (cancelled) return;
      setLoading(false);
      if (!outcome.ok) {
        setError(outcome.reason);
        return;
      }
      setItems(outcome.result.items);
      nextCursorRef.current = outcome.result.next_cursor;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, reloadKey]);

  // Deep-link (§1.2): состояние — в query-строке текущего path-роута `/issue`. Спека называет
  // это «URL-хэш» по историческому черновику до перехода витрины на path-роутинг (MF-524) —
  // здесь тот же приём deep-link, что у остальных path-экранов (projects/catalogstore.ts),
  // не буквальный `#/issue?...` (см. §Assumptions в финальном отчёте).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (tab !== "popular") params.set("tab", tab);
    else params.delete("tab");
    if (category) params.set("cat", category);
    else params.delete("cat");
    if (status) params.set("status", status);
    else params.delete("status");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [tab, category, status]);

  async function loadMore() {
    const current = itemsRef.current;
    if (!current || loadingMore || !nextCursorRef.current) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    const outcome = await listIdeas({ tab, category, status, cursor: nextCursorRef.current, limit: PAGE_SIZE });
    setLoadingMore(false);
    if (!outcome.ok) {
      setLoadMoreError(true);
      return;
    }
    setItems((prev) => (prev ? [...prev, ...outcome.result.items] : outcome.result.items));
    nextCursorRef.current = outcome.result.next_cursor;
  }

  return {
    tab,
    category,
    status,
    items,
    loading,
    error,
    hasMore: nextCursorRef.current !== null,
    loadingMore,
    loadMoreError,
    filtersActive: category !== undefined || status !== undefined,
    setTab,
    setCategory,
    setStatus,
    reset: () => {
      setCategory(undefined);
      setStatus(undefined);
    },
    retry: () => setReloadKey((k) => k + 1),
    loadMore: () => void loadMore(),
  };
}
