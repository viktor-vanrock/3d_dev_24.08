import { useCallback, useEffect, useId, useState, type ChangeEvent } from "react";
import type { SessionUser } from "@shared/types";
import { useActivation } from "@shared/lib";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, разрядка отложена до pages/DI (Этап 10). Cм. MIGRATION.md.
import "@pages/home/home.css";
import { headerModeFor, materialPath, materialsPath } from "../../../router.ts";
import { AuroraBackground, Button, Chip, EmptyState, Eyebrow, Heading, IconButton, Input } from "@shared/ui";
import {
  emptyMaterialFilters,
  fetchMaterialPage,
  hasMaterialFilters,
  kindLabel,
  MATERIAL_KINDS,
  materialFiltersToSearch,
  parseMaterialFilters,
  type MaterialFilters,
  type MaterialKind,
  type MaterialRecord,
} from "./catalog.ts";
import "./materials.css";

const KIND_LABELS: Record<MaterialKind, string> = {
  filament: "Филамент",
  resin: "Смола",
  plywood: "Фанера",
  aluminum: "Алюминий",
};

export function MaterialsScreen({ user, section, onSectionChange }: { user: SessionUser | null; section: Section; onSectionChange: (section: Section) => void }) {
  const activation = useActivation();
  const [filters, setFilters] = useState<MaterialFilters>(() => parseMaterialFilters(window.location.search));
  const [offset, setOffset] = useState(() => parseMaterialFilters(window.location.search).offset);
  const [qInput, setQInput] = useState(() => parseMaterialFilters(window.location.search).q);
  const [items, setItems] = useState<MaterialRecord[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const filterButtonId = useId();

  const focusFilterButton = useCallback(() => {
    document.getElementById(filterButtonId)?.focus();
  }, [filterButtonId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = qInput.trim().slice(0, 200);
      setFilters((current) => (current.q === value ? current : { ...current, q: value }));
      setOffset(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseMaterialFilters(window.location.search);
      setFilters(parsed);
      setOffset(parsed.offset);
      setQInput(parsed.q);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const query = materialFiltersToSearch(filters, offset);
    const target = `/materials${query}`;
    if (`${window.location.pathname}${window.location.search}` !== target) window.history.replaceState(null, "", target);
  }, [filters, offset]);

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileFiltersOpen(false);
        focusFilterButton();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusFilterButton, mobileFiltersOpen]);

  useEffect(() => {
    const controller = new AbortController();
    if (offset === 0) setItems(null);
    setLoading(true);
    setError(false);
    fetchMaterialPage(filters, offset, controller.signal)
      .then((page) => {
        // Spread: CatalogMaterialsDto.materials is readonly in generated schema; useState holds a mutable array.
        setItems((current) => (offset === 0 ? [...page.materials] : [...(current ?? []), ...page.materials]));
        setHasMore(page.has_more);
        setNextOffset(page.offset + page.materials.length);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [filters, offset, retry]);

  function updateFilter<K extends keyof MaterialFilters>(key: K, value: MaterialFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setOffset(0);
  }

  function resetFilters() {
    setFilters(emptyMaterialFilters());
    setQInput("");
    setOffset(0);
  }

  function closeMobileFilters() {
    setMobileFiltersOpen(false);
    focusFilterButton();
  }

  const controls = (
    <MaterialFilterControls
      filters={filters}
      qInput={qInput}
      onQueryChange={setQInput}
      onChange={updateFilter}
      materials={items ?? []}
    />
  );

  return (
    <div className="home materialsPage">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={activation.printers} section={section} onSectionChange={onSectionChange} mode={headerModeFor("materials")} />
      </div>
      <main className="homeContent materialsContent">
        <header className="materialsIntro">
          <Eyebrow>КАТАЛОГ МАТЕРИАЛОВ</Eyebrow>
          <Heading size="md">Материалы для печати</Heading>
          <p>Найдите линейку по бренду, типу или цвету.</p>
        </header>

        <div className="materialsMobileBar">
          <Button id={filterButtonId} variant="secondary" icon={null} className="materialsFilterButton" onClick={() => setMobileFiltersOpen(true)}>
            Фильтры{hasMaterialFilters(filters) ? " · есть" : ""}
          </Button>
        </div>

        <div className="materialsLayout">
          <aside className="materialsSidebar" aria-label="Фильтры каталога">
            {controls}
          </aside>

          <section className="materialsResults" aria-labelledby="materials-results-title">
            <div className="materialsResultsHeader">
              <Eyebrow>РЕЗУЛЬТАТЫ</Eyebrow>
              {hasMaterialFilters(filters) ? <Button variant="ghost" icon={null} className="materialsReset" onClick={resetFilters}>Сбросить фильтры</Button> : null}
            </div>
            <ActiveFilters filters={filters} onChange={updateFilter} />
            <h2 id="materials-results-title" className="srOnly">Материалы</h2>

            {error && items === null ? (
              <InlineError onRetry={() => setRetry((value) => value + 1)} />
            ) : items === null ? (
              <MaterialSkeletonGrid />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<SearchIcon />}
                title={hasMaterialFilters(filters) ? "По этим условиям материалов нет" : "Каталог материалов пока пуст"}
                action={
                  hasMaterialFilters(filters) ? null : (
                    <Button variant="secondary" icon={null} onClick={() => setRetry((value) => value + 1)}>Обновить</Button>
                  )
                }
              />
            ) : (
              <>
                <div className="materialsGrid">
                  {items.map((material) => <MaterialTile key={material.id} material={material} />)}
                </div>
                {error ? <InlineError onRetry={() => setRetry((value) => value + 1)} /> : null}
                {hasMore ? (
                  <Button
                    variant="secondary"
                    icon={null}
                    className="materialsLoadMore"
                    aria-busy={loading || undefined}
                    disabled={loading}
                    onClick={() => setOffset(nextOffset)}
                  >
                    {loading ? "Загружаем…" : "Показать ещё"}
                  </Button>
                ) : null}
              </>
            )}
          </section>
        </div>
      </main>

      {mobileFiltersOpen ? (
        <div className="materialsSheetBackdrop" role="presentation" onClick={closeMobileFilters}>
          <section className="materialsSheet" role="dialog" aria-modal="true" aria-labelledby="materials-sheet-title" onClick={(event) => event.stopPropagation()}>
            <div className="materialsSheetHeader">
              <h2 id="materials-sheet-title">Фильтры</h2>
              <IconButton label="Закрыть фильтры" onClick={closeMobileFilters}><CloseIcon /></IconButton>
            </div>
            {controls}
            <Button className="materialsSheetApply" icon={null} onClick={closeMobileFilters}>Показать результаты</Button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

// Detail принадлежит отдельной карточке, но маршрут уже должен быть каноническим и не
// возвращать пользователя в home. Полное содержимое detail собирается следующим срезом.
export function MaterialDetailScreen({ user, section, onSectionChange, id }: { user: SessionUser | null; section: Section; onSectionChange: (section: Section) => void; id: string }) {
  const activation = useActivation();
  return (
    <div className="home materialsPage">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={activation.printers} section={section} onSectionChange={onSectionChange} mode={headerModeFor("material")} />
      </div>
      <main className="homeContent materialsContent">
        <Eyebrow>МАТЕРИАЛ</Eyebrow>
        <Heading size="md">Карточка материала</Heading>
        <p className="materialsDetailId">{id}</p>
        <Button href={materialsPath()} variant="secondary" icon={null}>Вернуться в каталог</Button>
      </main>
    </div>
  );
}

function MaterialFilterControls({
  filters,
  qInput,
  onQueryChange,
  onChange,
  materials,
}: {
  filters: MaterialFilters;
  qInput: string;
  onQueryChange: (value: string) => void;
  onChange: <K extends keyof MaterialFilters>(key: K, value: MaterialFilters[K]) => void;
  materials: MaterialRecord[];
}) {
  const controlId = useId();
  const vendors = [...new Set(materials.map((material) => material.vendor.name))];
  const types = [...new Set(materials.map((material) => material.material_type.name))];
  function inputHandler(key: "vendor" | "type" | "color") {
    return (event: ChangeEvent<HTMLInputElement>) => onChange(key, event.target.value);
  }

  return (
    <div className="materialsFilters">
      <label className="materialsSearchField">
        <span className="srOnly">Поиск материалов</span>
        <SearchIcon />
        <Input value={qInput} onChange={(event) => onQueryChange(event.target.value)} placeholder="Поиск" maxLength={200} />
        {qInput ? <IconButton label="Очистить поиск" onClick={() => onQueryChange("")}><CloseIcon /></IconButton> : null}
      </label>
      <label className="materialsField">
        <Eyebrow>БРЕНД</Eyebrow>
        <span className="materialsTextControl">
          <Input value={filters.vendor} onChange={inputHandler("vendor")} placeholder="Введите бренд" list={`${controlId}-vendors`} />
          {filters.vendor ? <IconButton label="Очистить бренд" onClick={() => onChange("vendor", "")}><CloseIcon /></IconButton> : null}
        </span>
        <datalist id={`${controlId}-vendors`}>{vendors.map((vendor) => <option key={vendor} value={vendor} />)}</datalist>
      </label>
      <label className="materialsField">
        <Eyebrow>ТИП</Eyebrow>
        <span className="materialsTextControl">
          <Input value={filters.type} onChange={inputHandler("type")} placeholder="Введите тип" list={`${controlId}-types`} />
          {filters.type ? <IconButton label="Очистить тип" onClick={() => onChange("type", "")}><CloseIcon /></IconButton> : null}
        </span>
        <datalist id={`${controlId}-types`}>{types.map((type) => <option key={type} value={type} />)}</datalist>
      </label>
      <fieldset className="materialsField materialsKindField">
        <legend><Eyebrow>КЛАСС</Eyebrow></legend>
        <div className="materialsKindGroup" role="group" aria-label="Класс материала">
          {MATERIAL_KINDS.map((kind) => (
            <Chip key={kind} selected={filters.kind === kind} onClick={() => onChange("kind", filters.kind === kind ? "" : kind)}>
              {KIND_LABELS[kind]}
            </Chip>
          ))}
        </div>
      </fieldset>
      <label className="materialsField">
        <Eyebrow>ЦВЕТ</Eyebrow>
        <span className="materialsTextControl">
          <Input value={filters.color} onChange={inputHandler("color")} placeholder="Например, чёрный" />
          {filters.color ? <IconButton label="Очистить цвет" onClick={() => onChange("color", "")}><CloseIcon /></IconButton> : null}
        </span>
      </label>
    </div>
  );
}

function ActiveFilters({ filters, onChange }: { filters: MaterialFilters; onChange: <K extends keyof MaterialFilters>(key: K, value: MaterialFilters[K]) => void }) {
  if (!hasMaterialFilters(filters)) return null;
  const values: Array<{ key: keyof MaterialFilters; label: string; value: string }> = [
    { key: "q", label: "Поиск", value: filters.q },
    { key: "vendor", label: "Бренд", value: filters.vendor },
    { key: "type", label: "Тип", value: filters.type },
    { key: "kind", label: "", value: filters.kind ? kindLabel(filters.kind) : "" },
    { key: "color", label: "Цвет", value: filters.color },
  ];
  return (
    <div className="materialsActiveFilters" aria-label="Активные фильтры">
      <span>Активные фильтры</span>
      {values.filter((item) => item.value).map((item) => (
        <Button key={item.key} variant="secondary" icon={null} className="materialsFilterChip" onClick={() => onChange(item.key, "" as MaterialFilters[typeof item.key])}>
          {item.label ? `${item.label}: ` : ""}{item.value} ×
        </Button>
      ))}
    </div>
  );
}

function MaterialTile({ material }: { material: MaterialRecord }) {
  const kindStr = KIND_LABELS[material.kind as MaterialKind] ?? material.kind;
  const typeLine = material.material_type?.name ? `${material.material_type.name} · ${kindStr}` : kindStr;
  return (
    <a className="materialTile pressable" href={materialPath(material.id)} aria-label={`Открыть материал ${material.vendor.name} ${material.name}`}>
      <MaterialMark />
      <div className="materialTileVendor">{material.vendor.name}</div>
      <div className="materialTileName">{material.name}</div>
      <div className="materialTileMeta">{typeLine}</div>
    </a>
  );
}

function MaterialSkeletonGrid() {
  return (
    <div className="materialsGrid" role="status" aria-label="Загрузка материалов">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="materialTile materialTileSkeleton" data-skeleton="material-tile" aria-hidden="true">
          <span className="materialSkeletonMark" />
          <span className="materialSkeletonLine materialSkeletonLine--vendor" />
          <span className="materialSkeletonLine materialSkeletonLine--title" />
          <span className="materialSkeletonLine materialSkeletonLine--meta" />
        </div>
      ))}
    </div>
  );
}

function InlineError({ onRetry }: { onRetry: () => void }) {
  return <div className="materialsInlineError" role="alert"><span>Каталог не отвечает.</span><Button variant="ghost" icon={null} onClick={onRetry}>Обновить</Button></div>;
}

function MaterialMark() {
  return (
    <svg className="materialMark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 25c4-7 8 7 12 0s8 7 12 0 5 0 8-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function CloseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
