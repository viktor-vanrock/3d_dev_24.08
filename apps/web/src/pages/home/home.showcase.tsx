import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listModels, type MarketModel } from "@domains/commerce";
import { mergePublishedShowcase } from "@domains/social";
import { Eyebrow } from "@shared/ui";
import { ConceptTile } from "./concepttile.tsx";
import type { ConceptFlow } from "./conceptflow.ts";
import { useStableFeedKeys } from "./home.feedmixer.ts";
import type { SearchState } from "./home.search.tsx";
import { isShowcaseModel, ModelTileButton } from "./modeltile.tsx";
import { trackActivation } from "@shared/lib";

// --- Витрина: полки подборок либо результаты поиска — одно место (home.visual.md §3/§4) ---

const SHELF_FETCH_LIMIT = 8;

interface PopularFeed {
  models: MarketModel[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

// Реальные проекты имеют собственный cursor, concept-кэш — свой. Главная двигает оба курсора
// одним физическим scroll-событием, а рендер ниже перемешивает готовые результаты в одну сетку.
function usePopularFeed(): PopularFeed {
  const [models, setModels] = useState<MarketModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    void listModels({ sort: "popular", limit: SHELF_FETCH_LIMIT - 1 })
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        const initial = mergePublishedShowcase(
          (result?.models ?? []).filter(isShowcaseModel),
          { q: "", tags: [] },
        ).slice(0, SHELF_FETCH_LIMIT);
        initial.forEach((model) => seenRef.current.add(model.id));
        cursorRef.current = result?.next_cursor ?? null;
        setModels(initial);
        setHasMore(cursorRef.current !== null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(() => {
    if (loadingRef.current || cursorRef.current === null) return;
    loadingRef.current = true;
    setLoadingMore(true);
    void listModels({ sort: "popular", limit: SHELF_FETCH_LIMIT, cursor: cursorRef.current })
      .catch(() => null)
      .then((result) => {
        cursorRef.current = result?.next_cursor ?? null;
        const fresh = (result?.models ?? []).filter((model) => {
          if (!isShowcaseModel(model)) return false;
          if (seenRef.current.has(model.id)) return false;
          seenRef.current.add(model.id);
          return true;
        });
        if (fresh.length > 0) setModels((current) => [...current, ...fresh]);
        setHasMore(cursorRef.current !== null);
      })
      .finally(() => {
        loadingRef.current = false;
        setLoadingMore(false);
      });
  }, []);

  return { models, loading, loadingMore, hasMore, loadMore };
}

export function Showcase({
  query,
  searchState,
  onRetry,
  conceptFlow,
}: {
  query: string;
  searchState: SearchState;
  onRetry: () => void;
  conceptFlow: ConceptFlow;
}) {
  const trimmed = query.trim();
  const queryMode = trimmed.length >= 2;

  return (
    <section className="homeShowcase">
      {queryMode ? (
        <>
          {searchState.kind === "error" ? (
            <div className="homeSearchErrorBar">
              <span>Поиск сейчас недоступен</span>
              <button type="button" className="homeSearchRetry pressable" onClick={onRetry}>
                Повторить
              </button>
            </div>
          ) : null}
          <MixedResults key={trimmed} searchState={searchState} conceptFlow={conceptFlow} />
        </>
      ) : (
        <DefaultFeed conceptFlow={conceptFlow} />
      )}
    </section>
  );
}

function useInfiniteSentinel(hasMore: boolean, loadingMore: boolean, loadMore: () => void) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(loadingMore);
  const sentinelActiveRef = useRef(false);
  const continueAfterLoadRef = useRef(false);
  const lastScrollYRef = useRef(window.scrollY);
  loadingMoreRef.current = loadingMore;

  const startLoad = useCallback(() => {
    if (loadingMoreRef.current) return;
    sentinelActiveRef.current = true;
    loadingMoreRef.current = true;
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting);
        if (!isIntersecting) {
          sentinelActiveRef.current = false;
          return;
        }
        if (loadingMoreRef.current) {
          continueAfterLoadRef.current = true;
          return;
        }
        if (sentinelActiveRef.current) return;
        startLoad();
      },
      { rootMargin: "720px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, startLoad]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const onScroll = () => {
      const scrollY = window.scrollY;
      const scrollingDown = scrollY > lastScrollYRef.current + 1;
      lastScrollYRef.current = scrollY;
      const bounds = sentinel.getBoundingClientRect();
      const nearViewport = bounds.top <= window.innerHeight + 720 && bounds.bottom >= -720;
      if (!nearViewport) {
        sentinelActiveRef.current = false;
        return;
      }
      if (loadingMoreRef.current) {
        if (scrollingDown && bounds.top <= window.innerHeight && bounds.bottom >= 0) {
          continueAfterLoadRef.current = true;
        }
        return;
      }
      if (!scrollingDown) return;
      startLoad();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0) return;
      const bounds = sentinel.getBoundingClientRect();
      if (bounds.top > window.innerHeight || bounds.bottom < 0) return;
      if (loadingMoreRef.current) {
        continueAfterLoadRef.current = true;
        return;
      }
      startLoad();
    };
    const onTouchMove = () => {
      const bounds = sentinel.getBoundingClientRect();
      if (bounds.top > window.innerHeight || bounds.bottom < 0) return;
      if (loadingMoreRef.current) {
        continueAfterLoadRef.current = true;
        return;
      }
      startLoad();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, [hasMore, startLoad]);

  useEffect(() => {
    if (loadingMore || !hasMore) return;
    const continueAfterLoad = continueAfterLoadRef.current;
    continueAfterLoadRef.current = false;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const bounds = sentinel.getBoundingClientRect();
    const nearViewport = bounds.top <= window.innerHeight + 720 && bounds.bottom >= -720;
    // После добавления ряда sentinel обычно уезжает ниже rootMargin без отдельного
    // scroll-события. Сразу разрешаем следующий цикл, иначе первый быстрый докрут
    // после layout-shift ошибочно считается продолжением уже обработанного входа.
    if (!nearViewport) {
      sentinelActiveRef.current = false;
      return;
    }
    if (!continueAfterLoad || bounds.top > window.innerHeight || bounds.bottom < 0) return;
    sentinelActiveRef.current = false;
    startLoad();
  }, [hasMore, loadingMore, startLoad]);

  return sentinelRef;
}

function DefaultFeed({ conceptFlow }: { conceptFlow: ConceptFlow }) {
  const {
    models,
    loading,
    loadingMore: modelsLoadingMore,
    hasMore: modelsHaveMore,
    loadMore: loadMoreModels,
  } = usePopularFeed();
  const {
    concepts,
    initialLoading: conceptsInitialLoading,
    hasMore: conceptsHaveMore,
    loadingMore: conceptsLoadingMore,
    loadMore: loadMoreConcepts,
  } = conceptFlow;
  const hasMore = modelsHaveMore || conceptsHaveMore;
  const loadingMore = modelsLoadingMore || conceptsLoadingMore;
  const loadMore = useCallback(() => {
    loadMoreModels();
    loadMoreConcepts();
  }, [loadMoreConcepts, loadMoreModels]);
  const sentinelRef = useInfiniteSentinel(hasMore, loadingMore, loadMore);
  const feedKeys = useStableFeedKeys(
    models,
    concepts,
    loading || conceptsInitialLoading || loadingMore,
  );
  const modelById = new Map(models.map((model) => [model.id, model]));
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
  const tiles: ReactNode[] = [];
  feedKeys.forEach((item) => {
    if (item.source === "model") {
      const model = modelById.get(item.id);
      if (!model) return;
      tiles.push(
        <ModelTileButton
          key={`model-${model.id}`}
          model={model}
          index={tiles.length}
          hideBrokenPreview
          onOpen={(opened, position) => {
            trackActivation("gallery_tile_click", {
              model_id: opened.id,
              position: position + 1,
              collection: "popular",
            });
          }}
        />,
      );
      return;
    }
    const concept = conceptById.get(item.id);
    if (concept) {
      tiles.push(
        <ConceptTile
          key={`concept-${concept.id}`}
          concept={concept}
          index={tiles.length}
          onVisibilityChange={conceptFlow.setVisible}
          onSelect={conceptFlow.select}
        />,
      );
    }
  });

  return (
    <div className="homeShelf">
      <div className="homeGalleryHead">
        <Eyebrow>Популярно сейчас · Печатают чаще всего</Eyebrow>
      </div>
      <div className="homeMixedGrid">
        {tiles}
        {(loading || conceptsInitialLoading) && tiles.length === 0
          ? <SkeletonTiles count={SHELF_FETCH_LIMIT} start={0} />
          : null}
        {loadingMore ? <SkeletonTiles count={6} start={tiles.length} /> : null}
        <div ref={sentinelRef} className="homeConceptSentinel" aria-hidden="true" />
      </div>
    </div>
  );
}

function MixedResults({
  searchState,
  conceptFlow,
}: {
  searchState: SearchState;
  conceptFlow: ConceptFlow;
}) {
  const models = searchState.kind === "results"
    ? searchState.models.filter(isShowcaseModel)
    : [];
  const { concepts, hasMore, loadMore, loadingMore } = conceptFlow;
  const length = Math.max(models.length, concepts.length);
  const tiles: ReactNode[] = [];
  const sentinelRef = useInfiniteSentinel(hasMore, loadingMore, loadMore);

  for (let index = 0; index < length; index += 1) {
    const model = models[index];
    const concept = concepts[index];
    if (model) {
      tiles.push(
        <ModelTileButton
          key={`model-${model.id}`}
          model={model}
          index={tiles.length}
          hideBrokenPreview
        />,
      );
    }
    if (concept) {
      tiles.push(
        <ConceptTile
          key={`concept-${concept.id}`}
          concept={concept}
          index={tiles.length}
          onVisibilityChange={conceptFlow.setVisible}
          onSelect={(selected) => {
            trackActivation("home_hero_submit", {
              source: "generation_concept",
              variant_id: selected.id,
              motif: selected.motif,
            });
            conceptFlow.select(selected);
          }}
        />,
      );
    }
  }

  return (
    <section aria-label="Результаты">
      <div className="homeMixedGrid">
        {tiles}
        {searchState.kind === "loading"
          ? Array.from({ length: Math.max(2, 6 - tiles.length) }, (_, index) => (
              <div key={`skeleton-${index}`} className="homeModelTile homeModelTileSkeleton" style={{ ["--i" as string]: tiles.length + index }}>
                <span className="homeModelThumb" />
                <span className="homeModelMeta">
                  <span className="homeSkeletonBar" style={{ width: "70%" }} />
                  <span className="homeSkeletonBar" style={{ width: "45%" }} />
                </span>
              </div>
            ))
          : null}
        {loadingMore ? <SkeletonTiles count={6} start={tiles.length} /> : null}
        <div ref={sentinelRef} className="homeConceptSentinel" aria-hidden="true" />
      </div>
    </section>
  );
}

function SkeletonTiles({ count, start }: { count: number; start: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div
      key={`feed-tail-skeleton-${start}-${index}`}
      className="homeConceptTile homeConceptTile--skeleton homeConceptTile--tail-loading"
      style={{ ["--i" as string]: (start + index) % 6 }}
      aria-hidden="true"
    >
      <span className="homeConceptVisual" />
      <span className="homeConceptMeta" />
    </div>
  ));
}
