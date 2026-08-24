import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { resolveTier, useActivation, relativeDate } from "@shared/lib";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { useOverlay } from "@platform/overlay";
import { AuroraBackground, ActionCard, Card, Chip, CubeIcon, EmptyState, Eyebrow, StatusPill } from "@shared/ui";
import { addModelPath, marketSearch, navigate } from "../../router.ts";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { HoneypotLink } from "@domains/access";
import { getPrinterCompat } from "./compat.ts";
import { ContextFeedbackDoor } from "./contextfeedback.tsx";
import { FORMATS_HINT } from "./formats.ts";
import "./market.css";
import { ModelTile, hueFromId } from "./market.tile.tsx";
import { listModels, listTags, type MarketModel, type ModelSort, type ModelStatus } from "./models.ts";

export { hueFromId, ModelTile };

// Экран Маркетплейса v2 (MF-463, docs/design/marketplace.v2.md §2): поиск + сортировка/теги +
// галерея + пагинация «Показать ещё». Статусы — поллингом /models раз в 4с (без websocket).
// Плитка каталога (ModelTile) и hueFromId — market.tile.tsx (MF-911, разбиение по секциям).

const POLL_INTERVAL_MS = 4000;
const PAGE_SIZE = 24;

export const STATUS_META: Record<ModelStatus, { tone: "ok" | "warn" | "danger" | "dim"; label: string; pulse?: boolean } | null> = {
  uploaded: { tone: "dim", label: "В очереди" },
  pending: { tone: "dim", label: "В очереди" },
  processing: { tone: "ok", label: "Конвертация", pulse: true },
  ready: null,
  failed: { tone: "danger", label: "Ошибка" },
};

// relativeDate вынесен в shared/lib (микроэтап 7.6) — общий форматтер для social.
// Реэкспорт сохраняет существующие импорты внутри commerce.
export { relativeDate };

export function MarketplaceScreen({
  user,
  section,
  onSectionChange,
  initialTag,
  initialQ,
  initialSort,
}: {
  // Гость читает каталог без входа (MF-850/MF-912) — `owner.id === user?.id` ниже просто
  // никогда не совпадает, «мои модели» гостю не показываются, а не падают на user.id.
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  initialTag?: string;
  initialQ?: string;
  initialSort?: ModelSort;
}) {
  const activation = useActivation();
  const overlay = useOverlay();
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const tier = resolveTier(activation.activation, activation.printers);

  const [models, setModels] = useState<MarketModel[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [qInput, setQInput] = useState(initialQ ?? "");
  const [q, setQ] = useState(initialQ ?? "");
  const [sort, setSort] = useState<ModelSort>(initialSort ?? "new");
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTag ? [initialTag] : []);
  const [paidFilter, setPaidFilter] = useState<"all" | "paid" | "free">("all");
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  // Фильтр «совместимо с моим парком» (MF-11, Фаза 3 MF-410): чип виден только когда у
  // зрителя есть парк (activation.printers). Чек по-настоящему через compat.check
  // (getPrinterCompat), не заглушку — эндпоинт уже читает models.bbox сам по model_id, клиенту
  // не нужен bbox в листинге. compatCacheRef переживает ре-рендеры и клавиатуру опроса раз в
  // 4с (та же модель на странице — кэш-хит, не перезапрашиваем); ключ включает printerIdsKey,
  // поэтому смена парка сама инвалидирует старые записи, без отдельного эффекта сброса.
  const [fleetFilterActive, setFleetFilterActive] = useState(false);
  const compatCacheRef = useRef<Map<string, boolean>>(new Map());
  const [, forceCompatRerender] = useState(0);
  const seenFailed = useRef<Set<string>>(new Set());
  const modelsRef = useRef<MarketModel[] | null>(null);
  modelsRef.current = models;
  // Курсор keyset-пагинации (MF-603): значение из ответа сервера, передаём как есть в loadMore.
  const nextCursorRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [qInput]);

  // Фильтры — шэрабельная ссылка (Фаза 3 MF-347, «сохранение фильтров в URL»): тот же приём
  // тихого replaceState, что и facetsToSearch в printersscreen.tsx — не спамим историю на
  // каждый ввод в строке поиска.
  useEffect(() => {
    const target = `${window.location.pathname}${marketSearch({ tag: selectedTags[0], q, sort })}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (target !== current) {
      window.history.replaceState(null, "", target);
    }
  }, [q, sort, selectedTags]);

  useEffect(() => {
    void listTags().then(setAvailableTags);
  }, []);

  const filtersKey = `${q}|${sort}|${selectedTags.join(",")}|${paidFilter}`;
  const printerIdsKey = activation.printers.map((printer) => printer.id).join(",");

  // N+1 по дизайну (по одному GET на пару модель×принтер) — опт-ин: считаем только пока чип
  // включён, и только для моделей уже загруженной страницы (PAGE_SIZE), не всего каталога.
  // Модель проходит фильтр, если хотя бы один принтер парка даёт verdict !== 'blocked'
  // («совместимо с ПАРКОМ», не «со всеми станками сразу»).
  useEffect(() => {
    if (!fleetFilterActive || activation.printers.length === 0 || !models) return;
    const pending = models.filter((model) => !compatCacheRef.current.has(`${model.id}::${printerIdsKey}`));
    if (pending.length === 0) return;
    let cancelled = false;
    void Promise.all(
      pending.map(async (pendingModel) => {
        const verdicts = await Promise.all(
          activation.printers.map((printer) => getPrinterCompat(printer.id, { modelId: pendingModel.id })),
        );
        const compatible = verdicts.some((result) => result !== null && result.verdict !== "blocked");
        return [pendingModel.id, compatible] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      for (const [modelId, compatible] of entries) compatCacheRef.current.set(`${modelId}::${printerIdsKey}`, compatible);
      forceCompatRerender((version) => version + 1);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetFilterActive, models, printerIdsKey]);

  const visibleModels =
    fleetFilterActive && models
      ? models.filter((model) => compatCacheRef.current.get(`${model.id}::${printerIdsKey}`) !== false)
      : models;

  function notifyFailed(pageModels: MarketModel[]) {
    for (const model of pageModels) {
      if (model.status === "failed" && model.owner.id === user?.id && !seenFailed.current.has(model.id)) {
        seenFailed.current.add(model.id);
        overlayRef.current.toast({
          severity: "critical",
          title: "Не удалось конвертировать модель",
          message: "Попробуйте другой файл.",
        });
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    void listModels({
      limit: PAGE_SIZE,
      q: q || undefined,
      sort,
      tag: selectedTags.length > 0 ? selectedTags : undefined,
      paid: paidFilter === "all" ? undefined : paidFilter === "paid",
    }).then((result) => {
      if (cancelled) return;
      if (!result) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      notifyFailed(result.models);
      setModels(result.models);
      setHasMore(result.has_more);
      nextCursorRef.current = result.next_cursor;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      const current = modelsRef.current;
      if (!current || current.length === 0) return;
      void listModels({
        limit: current.length,
        q: q || undefined,
        sort,
        tag: selectedTags.length > 0 ? selectedTags : undefined,
        paid: paidFilter === "all" ? undefined : paidFilter === "paid",
      }).then((result) => {
        if (!result) return;
        notifyFailed(result.models);
        setModels(result.models);
        setHasMore(result.has_more);
        nextCursorRef.current = result.next_cursor;
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  async function loadMore() {
    const current = modelsRef.current;
    if (!current || loadingMore) return;
    setLoadingMore(true);
    const result = await listModels({
      limit: PAGE_SIZE,
      cursor: nextCursorRef.current ?? undefined,
      q: q || undefined,
      sort,
      tag: selectedTags.length > 0 ? selectedTags : undefined,
      paid: paidFilter === "all" ? undefined : paidFilter === "paid",
    });
    setLoadingMore(false);
    if (!result) return;
    setModels((prev) => (prev ? [...prev, ...result.models] : result.models));
    setHasMore(result.has_more);
    nextCursorRef.current = result.next_cursor;
  }

  const dismissedBanner = !!activation.activation?.home_dismissed_prompts?.marketplace_experimental;

  function toggleTag(tag: string) {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  }

  const filtersActive = q.length > 0 || selectedTags.length > 0 || fleetFilterActive || paidFilter !== "all";

  return (
    <div className="home" data-tier={tier}>
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={activation.printers} section={section} onSectionChange={onSectionChange} />
      </div>
      <main className="homeContent">
        <div className="marketIntro">
          <Eyebrow>Проекты</Eyebrow>
          <StatusPill tone="warn">ЭКСПЕРИМЕНТАЛЬНО · Проекты</StatusPill>
        </div>

        {!dismissedBanner ? (
          <Card className="marketBanner">
            <p>
              Проекты — экспериментальный раздел. Пока это скелет: загрузка проектов и поиск работают, но покупка
              и печать появятся позже.
            </p>
            <button
              type="button"
              className="pressable ovlModalConfirm"
              onClick={() =>
                activation.patch({
                  home_dismissed_prompts: {
                    ...activation.activation?.home_dismissed_prompts,
                    marketplace_experimental: true,
                  },
                })
              }
            >
              Понятно
            </button>
          </Card>
        ) : null}

        <div className="marketSearchBar">
          <SearchIcon />
          <input
            className="marketSearchInput"
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            placeholder="Найти проект…"
            aria-label="Поиск проектов"
          />
        </div>

        <div className="marketLayout">
          <Card className="marketSidebar">
            <Eyebrow>Сортировка</Eyebrow>
            <div className="marketChipRow">
              <Chip selected={sort === "new"} onClick={() => setSort("new")}>
                Новые
              </Chip>
              <Chip selected={sort === "popular"} onClick={() => setSort("popular")}>
                Популярные
              </Chip>
            </div>

            <Eyebrow>Стоимость</Eyebrow>
            <div className="marketChipRow" role="group" aria-label="Стоимость проекта">
              <Chip selected={paidFilter === "all"} onClick={() => setPaidFilter("all")}>Все</Chip>
              <Chip selected={paidFilter === "free"} onClick={() => setPaidFilter("free")}>Бесплатно</Chip>
              <Chip selected={paidFilter === "paid"} onClick={() => setPaidFilter("paid")}>Платно</Chip>
            </div>

            {activation.printers.length > 0 ? (
              <>
                <Eyebrow>Мой парк</Eyebrow>
                <div className="marketChipRow">
                  <Chip selected={fleetFilterActive} onClick={() => setFleetFilterActive((active) => !active)}>
                    Совместимо с моим принтером
                  </Chip>
                </div>
              </>
            ) : null}

            {availableTags.length > 0 ? (
              <>
                <Eyebrow>Теги</Eyebrow>
                <div className="marketChipRow">
                  {availableTags.map((tag) => (
                    <Chip key={tag} selected={selectedTags.includes(tag)} onClick={() => toggleTag(tag)}>
                      {tag}
                    </Chip>
                  ))}
                </div>
              </>
            ) : null}

            {filtersActive ? (
              <button
                type="button"
                className="marketResetFilters pressable"
                onClick={() => {
                  setQInput("");
                  setSelectedTags([]);
                  setFleetFilterActive(false);
                  setPaidFilter("all");
                }}
              >
                Сбросить фильтры ✕
              </button>
            ) : null}

            <div className="marketAddAction">
              <ActionCard
                variant="primary"
                title="Добавить проект"
                sub={FORMATS_HINT}
                icon={<PlusIcon />}
                onClick={() => navigate(addModelPath())}
              />
            </div>
          </Card>

          <div className="marketContent">
            {loadError ? <div className="marketLoadError">Не удалось загрузить галерею. Проверьте связь.</div> : null}

            {visibleModels === null ? null : visibleModels.length === 0 ? (
              <EmptyState
                icon={<CubeIcon />}
                title={filtersActive ? "Ничего не найдено" : "Здесь появятся ваши проекты"}
                sub={
                  filtersActive
                    ? "Попробуйте другой запрос или сбросьте фильтры."
                    : "Загрузите первый — модель для печати, программу ЧПУ, чертёж, плату или код. До 100 МБ."
                }
                action={
                  filtersActive ? (
                    <ContextFeedbackDoor preset="suggest" context={{ title: q || selectedTags[0], category: "catalog" }} />
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="homeGallery">
                  <HoneypotLink />
                  {visibleModels.map((model, index) => (
                    <ModelTile key={model.id} model={model} index={index} mine={model.owner.id === user?.id} />
                  ))}
                </div>
                {hasMore ? (
                  <button type="button" className="marketShowMore pressable" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? "Загрузка…" : "Показать ещё"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </main>
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
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
