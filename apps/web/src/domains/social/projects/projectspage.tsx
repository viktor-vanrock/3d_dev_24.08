import { useEffect } from "react";
import type { SessionUser } from "@shared/types";
import { resolveTier, useActivation, isCompatible, type ActivationState } from "@shared/lib";
import { HomeHeader, type Section, useSectionSwipeNav } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { AuroraBackground, Button, Card, Chip, EmptyState, Eyebrow, SegmentToggle } from "@shared/ui";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { ContextFeedbackDoor } from "@domains/commerce";
// Стили каталога (плитки моделей/ContextFeedbackDoor) — CSS commerce. Легатное
// междоменное ребро (микроэтап 7.6): развязка стилей отложена. Путь восстановлен
// после Этапа 6 (regex переноса ошибочно свернул "../market/market.css" в barrel).
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- CSS side-effect, не index.ts; легатное ребро social→commerce, см. выше.
import "../../commerce/market.css";
import { addModelPath, headerModeFor, navigate, printersPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { useCatalogQuery } from "./catalogstore.ts";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): social→ai ASSISTANT_CONTEXT_SEARCH_EVENT (проекты слушают контекстный поиск ассистента), развязка отложена до pages/DI. См. MIGRATION.md.
import { ASSISTANT_CONTEXT_SEARCH_EVENT, type AssistantContextSearchDetail } from "@domains/ai";
import { HeroCarousel } from "./hero.tsx";
import { usePullToRefresh } from "./pulltorefresh.ts";
import { PullToRefreshIndicator } from "./pulltorefreshindicator.tsx";
import { ProjectTile } from "./projecttile.tsx";
import "./projects.css";

const PROJECT_FACETS = [
  { tag: "ams", label: "AMS / многоцвет" },
  { tag: "без ams", label: "Без AMS" },
  { tag: "sla", label: "SLA / смола" },
  { tag: "чпу", label: "Для ЧПУ" },
] as const;

// Страница «Проекты» (MF-512, эпик MF-508, docs/design/projects.page.md): wide-шапка (§1) +
// hero-карусель featured (§2) + живой поиск/единый store фильтров (§3) + каталог (§4), в
// иерархии hero → поиск → каталог+фильтры. Раскладку каталога (сайдбар/сетка) переиспользует
// v2 (marketplace.v2.md §1), только обёрнута в wide-контейнер и unified store вместо
// локального useState.
export function ProjectsPage({
  user,
  section,
  onSectionChange,
  renderHeader = true,
  activationState,
}: {
  // Гость видит каталог «Проекты» без входа (MF-850/MF-912) — `owner.id === user?.id` ниже
  // просто никогда не совпадает, «мои» плитки гостю не подсвечиваются.
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  renderHeader?: boolean;
  activationState?: ActivationState;
}) {
  const localActivation = useActivation(!activationState);
  const activation = activationState ?? localActivation;
  const tier = resolveTier(activation.activation, activation.printers);
  const catalog = useCatalogQuery();
  const setProjectQuery = catalog.setQ;
  const sound = useInteractionSound();
  // Свайп между разделами (touch.nav.md §2) — второй вход к тем же NAV_ITEMS, что таббар/пилюля;
  // hero-карусель внутри забирает горизонтальный жест себе (excludeSelector по умолчанию).
  const swipe = useSectionSwipeNav(section, onSectionChange);
  // Pull-to-refresh (touch.nav.md §3) — единственная сегодня настоящая перезагружаемая лента.
  // Оба жеста висят на одном `<main>` — axis-lock в каждом хуке независимо решает, чей это жест.
  const pullToRefresh = usePullToRefresh(catalog.refresh);
  const visibleModels =
    catalog.models && catalog.fitMine && activation.printers.length > 0
      ? catalog.models.filter((model) => activation.printers.some((printer) => isCompatible(model, printer)))
      : catalog.models;

  // Скролл-контейнер — окно (§3 спеки: здесь нет внутреннего overflow-контейнера) — гасим
  // резиновый скролл самой ОС на body, иначе он путается с жестом pull-to-refresh.
  useEffect(() => {
    const previous = document.body.style.overscrollBehaviorY;
    document.body.style.overscrollBehaviorY = "contain";
    return () => {
      document.body.style.overscrollBehaviorY = previous;
    };
  }, []);

  useEffect(() => {
    const onContextSearch = (event: Event) => {
      const detail = (event as CustomEvent<AssistantContextSearchDetail>).detail;
      if (detail?.context.kind === "projects") setProjectQuery(detail.query);
    };
    window.addEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, onContextSearch);
    return () => window.removeEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, onContextSearch);
  }, [setProjectQuery]);

  return (
    <div className="home projectsWide" data-tier={tier}>
      <AuroraBackground />
      {renderHeader ? (
        <div style={{ position: "relative", zIndex: 30 }}>
          <HomeHeader
            user={user}
            printers={activation.printers}
            section={section}
            onSectionChange={onSectionChange}
            mode={headerModeFor("market")}
          />
        </div>
      ) : null}

      <main
        className="projectsWideBody homeWorkspaceBody"
        style={swipe.dragX !== 0 ? { transform: `translateX(${swipe.dragX}px)` } : undefined}
        onPointerDown={(event) => {
          swipe.onPointerDown(event);
          pullToRefresh.onPointerDown(event);
        }}
        onPointerMove={(event) => {
          swipe.onPointerMove(event);
          pullToRefresh.onPointerMove(event);
        }}
        onPointerUp={(event) => {
          swipe.onPointerUp(event);
          pullToRefresh.onPointerUp(event);
        }}
        onPointerCancel={(event) => {
          swipe.onPointerCancel(event);
          pullToRefresh.onPointerCancel(event);
        }}
      >
        <PullToRefreshIndicator phase={pullToRefresh.phase} distance={pullToRefresh.distance} />
        <HeroCarousel />

        <section className="projectsPromise" aria-labelledby="projectsPromiseTitle">
          <div className="projectsPromiseCopy">
            <Eyebrow>Проекты мастерской</Eyebrow>
            <h1 id="projectsPromiseTitle">Соберите вещь целиком</h1>
            <p>Не отдельный файл, а понятный путь от деталей до работающего результата.</p>
            <Button className="projectsHeroAdd" onPointerDown={sound.tick} onClick={() => navigate(addModelPath())}>
              <PlusIcon />
              Добавить проект
            </Button>
          </div>
          <ol className="projectsPromiseFlow" aria-label="Из чего состоит проект">
            <li>
              <span>01</span>
              <strong>Распечатать</strong>
              <small>модели и чертежи</small>
            </li>
            <li>
              <span>02</span>
              <strong>Докупить</strong>
              <small>крепёж и компоненты</small>
            </li>
            <li>
              <span>03</span>
              <strong>Собрать</strong>
              <small>по шагам с фото и 3D</small>
            </li>
          </ol>
        </section>

        <div className="marketLayout projectsCatalogLayout">
          <Card className="marketSidebar projectsSidebar">
            <Eyebrow>Показывать сначала</Eyebrow>
            <div className="marketChipRow">
              <SegmentToggle
                ariaLabel="Сортировка"
                options={[
                  { value: "new", label: "Новые" },
                  { value: "popular", label: "Популярные" },
                ]}
                value={catalog.sort}
                onChange={catalog.setSort}
                onPress={sound.toggle}
              />
            </div>

            <div className="projectsSidebarSection">
              <Eyebrow>Способ изготовления</Eyebrow>
              <div className="projectsFacetGrid">
                {PROJECT_FACETS.map((facet) => (
                  <Chip
                    key={facet.tag}
                    selected={catalog.tags.includes(facet.tag)}
                    onPress={sound.toggle}
                    onClick={() => catalog.toggleTag(facet.tag)}
                  >
                    {facet.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="projectsSidebarSection">
              <Eyebrow>Моя мастерская</Eyebrow>
              {activation.printers.length > 0 ? (
                <>
                  <Chip selected={catalog.fitMine} onPress={sound.toggle} onClick={() => catalog.setFitMine(!catalog.fitMine)}>
                    Мои принтеры · {activation.printers.length}
                  </Chip>
                  <p className="projectsSidebarHint">
                    Пока отбираем по способу изготовления. Точную геометрию добавит движок совместимости.
                  </p>
                </>
              ) : (
                <Button variant="ghost" className="projectsConnectPrinter" onPointerDown={sound.tick} onClick={() => navigate(printersPath())}>
                  <span>Добавить свой принтер</span>
                  <small>Чтобы позже фильтровать проекты под него</small>
                </Button>
              )}
            </div>

            {catalog.availableTags.length > 0 ? (
              <div className="projectsSidebarSection">
                <Eyebrow>Популярные запросы</Eyebrow>
                <ul className="projectsPopularList" aria-label="Популярные запросы">
                  {catalog.availableTags.map((tag) => (
                    <li key={tag.name}>
                      <Chip
                        selected={catalog.tags.length === 1 && catalog.tags[0] === tag.name}
                        onPress={sound.toggle}
                        onClick={() => catalog.selectPopularTag(tag.name)}
                      >
                        <span>{tag.name}</span>
                        <span className="projectsPopularCount">{tag.count}</span>
                        <span className="srOnly"> проектов</span>
                      </Chip>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {catalog.filtersActive ? (
              <Button variant="ghost" icon={null} className="marketResetFilters" onPointerDown={sound.tick} onClick={catalog.reset}>
                Сбросить фильтры ✕
              </Button>
            ) : null}

          </Card>

          <div className="marketContent">
            {catalog.loadError ? (
              <div className="marketLoadError">Не удалось загрузить каталог. Проверьте связь.</div>
            ) : null}

            {visibleModels === null ? <ProjectSkeletonGrid /> : visibleModels.length === 0 ? (
              <EmptyState
                icon={<CubeIcon />}
                title={catalog.filtersActive ? "Ничего не нашлось" : "Здесь появятся проекты"}
                sub={
                  catalog.filtersActive
                    ? "Попробуйте другой запрос или сбросьте фильтры."
                    : "Начните с основного файла, затем добавьте описание и материалы проекта."
                }
                action={
                  catalog.filtersActive ? (
                    <div className="cfbEmptyActions">
                      <Button
                        variant="ghost"
                        icon={null}
                        className="marketResetFilters"
                        onPointerDown={sound.tick}
                        onClick={catalog.reset}
                      >
                        Сбросить
                      </Button>
                      <ContextFeedbackDoor preset="suggest" context={{ title: catalog.q || catalog.tags[0], category: "catalog" }} />
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="homeGallery">
                  {visibleModels.map((model, index) => (
                    <ProjectTile key={model.id} model={model} index={index} mine={model.owner.id === user?.id} />
                  ))}
                </div>
                {catalog.hasMore ? (
                  <Button
                    variant="secondary"
                    className="marketShowMore"
                    onPointerDown={sound.tick}
                    onClick={catalog.loadMore}
                    loading={catalog.loadingMore}
                  >
                    {catalog.loadingMore ? "Загрузка…" : "Показать ещё"}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// Каркас повторяет реальную 16:10-обложку, высоту текста и подвал ProjectTile. Поэтому ответ
// каталога заменяет содержимое на месте, а не сдвигает страницу вниз после пустого первого кадра.
export function ProjectSkeletonGrid() {
  return (
    <div className="homeGallery projectSkeletonGrid" role="status" aria-label="Загрузка проектов">
      {Array.from({ length: 6 }, (_, index) => (
        <article key={index} className="projectTileSkeleton" aria-hidden="true">
          <div className="projectTileSkeletonCover" />
          <div className="projectTileSkeletonBody">
            <span className="projectTileSkeletonLine" style={{ width: "42%" }} />
            <span className="projectTileSkeletonLine projectTileSkeletonLine--title" style={{ width: "78%" }} />
            <span className="projectTileSkeletonLine" style={{ width: "92%" }} />
            <span className="projectTileSkeletonLine" style={{ width: "64%" }} />
            <div className="projectTileSkeletonFooter">
              <span className="projectTileSkeletonPill" />
              <span className="projectTileSkeletonPill" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
