import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { AuroraBackground, Chip, EmptyState, Eyebrow } from "@shared/ui";
import { marketPath, modelPath, navigate, profilePath } from "../../router.ts";
import {
  type FilterOption,
  ISSUE_TAG_LABELS,
  listMachineOptions,
  listMakes,
  listMaterialOptions,
  type MakeSummary,
} from "./makes.ts";
import { hueFromId, relativeDate } from "./market.tsx";
import "./market.css";
import "./makesgallery.css";

// Галерея Make (MF-777, слайс Фазы 3 MF-27/MF-395): глобальная лента опубликованных Make с
// фильтрами по принтеру/филаменту. «Категория модели» из карточки — тот же tag-фильтр, что и
// каталог моделей (см. Data-комментарий make_compat_aggregates.sql — отдельной оси категорий
// нет). Публикация Make (форма-степпер «Я напечатал») — MF-394, отдельный слайс, сюда не входит.
// Детальная страница конкретного Make тоже MF-394 — до неё тайл ведёт на карточку модели.

const PAGE_SIZE = 24;

export function MakesGalleryScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const [machineOptions, setMachineOptions] = useState<FilterOption[]>([]);
  const [materialOptions, setMaterialOptions] = useState<FilterOption[]>([]);
  const [machineId, setMachineId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [sort, setSort] = useState<"new" | "popular">("new");

  const [items, setItems] = useState<MakeSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    void listMachineOptions().then(setMachineOptions);
    void listMaterialOptions().then(setMaterialOptions);
  }, []);

  useEffect(() => {
    const loadId = ++loadIdRef.current;
    setItems(null);
    void listMakes({ machineId: machineId || undefined, materialId: materialId || undefined, sort, limit: PAGE_SIZE }).then(
      (result) => {
        if (loadIdRef.current !== loadId || !result) return;
        setItems(result.items);
        setHasMore(result.next_cursor !== null);
        nextCursorRef.current = result.next_cursor;
      },
    );
  }, [machineId, materialId, sort]);

  async function loadMore() {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    const result = await listMakes({
      machineId: machineId || undefined,
      materialId: materialId || undefined,
      sort,
      limit: PAGE_SIZE,
      cursor: nextCursorRef.current ?? undefined,
    });
    setLoadingMore(false);
    if (!result) return;
    setItems((prev) => (prev ? [...prev, ...result.items] : result.items));
    setHasMore(result.next_cursor !== null);
    nextCursorRef.current = result.next_cursor;
  }

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} onBack={() => navigate(marketPath())} />
      </div>
      <main className="homeContent">
        <div className="profileSection">
          <Eyebrow>Печати сообщества</Eyebrow>

          <div className="makesFilters">
            <select
              className="makesFilterSelect"
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              aria-label="Фильтр по принтеру"
            >
              <option value="">Все принтеры</option>
              {machineOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="makesFilterSelect"
              value={materialId}
              onChange={(event) => setMaterialId(event.target.value)}
              aria-label="Фильтр по филаменту"
            >
              <option value="">Все филаменты</option>
              {materialOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="makesSortChips">
              <Chip selected={sort === "new"} onClick={() => setSort("new")}>
                Новые
              </Chip>
              <Chip selected={sort === "popular"} onClick={() => setSort("popular")}>
                Популярные
              </Chip>
            </div>
          </div>

          {items === null ? null : items.length === 0 ? (
            <EmptyState icon={<PrintIcon />} title="Пока нет печатей" sub="Тут появятся опубликованные Make — фото готовых печатей от сообщества." />
          ) : (
            <>
              <div className="homeGallery">
                {items.map((make, index) => (
                  <MakeTile key={make.id} make={make} index={index} />
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
      </main>
    </div>
  );
}

function MakeTile({ make, index }: { make: MakeSummary; index: number }) {
  return (
    <div
      className="homeModelTile pressable"
      style={{ ["--i" as string]: index, ["--tile-hue" as string]: hueFromId(make.id) }}
      onClick={() => navigate(modelPath(make.model_id))}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") navigate(modelPath(make.model_id));
      }}
    >
      <span className="homeModelThumb">
        <span className="homeModelGlow" aria-hidden="true" />
        <span className="homeModelArt">
          <span className="homeModelLayer homeModelLayerFront">
            <PrintIcon />
          </span>
        </span>
        <span className="homeModelShadow" aria-hidden="true" />
        {make.printability_rating ? <span className="makesTileRating">{"★".repeat(make.printability_rating)}</span> : null}
      </span>
      <span className="homeModelMeta">
        <span className="homeModelName">{make.model_title}</span>
        <span
          className="homeModelSub marketTileAuthor pressable"
          onClick={(event) => {
            event.stopPropagation();
            navigate(profilePath(make.author.username));
          }}
        >
          <AvatarBubble
            config={make.author.avatar_config ?? deterministicAvatarConfig(make.author.username || make.author.id)}
            snapshots={make.author.avatar_config ? make.author.avatar_snapshots : null}
            size={18}
            facing="front"
          />
          @{make.author.username}
        </span>
        <span className="marketTileMeta">
          {make.machine_model ? <span>{make.machine_model}</span> : null}
          <span>▲ {make.likes_count}</span>
          <span>{relativeDate(make.created_at)}</span>
        </span>
        {make.issue_tags.length > 0 ? (
          <span className="makesTileIssues">
            {make.issue_tags.map((tag) => (
              <span key={tag} className="makesTileIssueTag">
                {ISSUE_TAG_LABELS[tag]}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function PrintIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9V4h12v5M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v6H6v-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
