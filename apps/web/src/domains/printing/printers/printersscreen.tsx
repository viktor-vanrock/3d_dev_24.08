import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 8): printing→access useGuestLogin (гостевой вход), развязка отложена до pages/DI. См. MIGRATION.md.
import { useGuestLogin } from "@domains/access";
import type { SessionUser } from "@shared/types";
import { useActivation, type ActivationState } from "@shared/lib";
import { HomeHeader, type Section, useSectionSwipeNav } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): printing→ai ASSISTANT_CONTEXT_SEARCH_EVENT/listPrinters/PrinterRecord/KINEMATICS_OPTIONS (каталог принтеров читает исследовательскую базу и слушает контекстный поиск ассистента), развязка отложена до pages/DI. См. MIGRATION.md.
import { ASSISTANT_CONTEXT_SEARCH_EVENT, type AssistantContextSearchDetail, listPrinters, type PrinterRecord, KINEMATICS_OPTIONS } from "@domains/ai";
import { headerModeFor, issueNewPath, materialsPath, navigate, parkAddPath, researchNewPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, SegmentToggle, Chip, EmptyState, Eyebrow, PrinterIcon } from "@shared/ui";
import { ComparePanel } from "./comparepanel.tsx";
import { useCompareSet } from "./comparestate.ts";
import { catalogViewSource, markPrinterCardSource, trackPrinterEvent } from "./events.ts";
import {
  applyFacets,
  brandCounts,
  computeGap,
  emptyFacetState,
  facetsToSearch,
  parseFacetsFromSearch,
  sortPrinters,
  toggleValue,
  wouldBeEmpty,
  type CapabilityKey,
  type ConnectivityKey,
  type FacetState,
  type FamilyKey,
  type KinematicsKey,
  type PrinterStatusKey,
  type SupportLevelKey,
} from "./facets.ts";
import { GapRow } from "./gaprow.tsx";
import { CAPABILITY_LABEL, CONNECTIVITY_LABEL, STATUS_LABEL, SUPPORT_LEVEL_LABEL } from "./labels.ts";
import "./printers.css";
import { PrinterTile } from "./printertile.tsx";
import { RangeSlider } from "./rangeslider.tsx";

const CAPABILITY_ORDER: CapabilityKey[] = ["ams", "laser", "enclosed", "auto_leveling", "hardened", "moonraker", "lan_mode"];
const KINEMATICS_ORDER: KinematicsKey[] = ["corexy", "cartesian", "delta", "idex", "scara", "polar", "belt"];
const CONNECTIVITY_ORDER: ConnectivityKey[] = ["wifi", "ethernet", "camera"];
const STATUS_ORDER: PrinterStatusKey[] = ["announced", "shipping", "eol", "rumored"];
const SUPPORT_LEVEL_ORDER: SupportLevelKey[] = ["list", "managed", "custom"];
const BRAND_TOP_COUNT = 6;
const FIT_PRESETS = [220, 300];

export function PrintersScreen({
  user,
  section,
  onSectionChange,
  view,
  renderHeader = true,
  activationState,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  view?: "new";
  renderHeader?: boolean;
  activationState?: ActivationState;
}) {
  const swipe = useSectionSwipeNav(section, onSectionChange);
  const sound = useInteractionSound();
  const promptGuestLogin = useGuestLogin();
  const localActivation = useActivation(!activationState);
  const activation = activationState ?? localActivation;
  const isResearcher = user?.role === "researcher";

  const [printers, setPrinters] = useState<PrinterRecord[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [state, setState] = useState<FacetState>(() => parseFacetsFromSearch(window.location.search));
  const [qInput, setQInput] = useState(state.q);
  const [brandsExpanded, setBrandsExpanded] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [gapExpanded, setGapExpanded] = useState(false);
  const [catalogView, setCatalogView] = useState(view === "new");
  const compare = useCompareSet();
  const todayMs = useMemo(() => Date.now(), []);
  const initialFacetState = useRef(state);
  const catalogViewTracked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    listPrinters()
      .then((data) => {
        if (!cancelled) setPrinters(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setState((s) => ({ ...s, q: qInput.trim() })), 350);
    return () => clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    const onContextSearch = (event: Event) => {
      const detail = (event as CustomEvent<AssistantContextSearchDetail>).detail;
      if (detail?.context.kind === "printers") setQInput(detail.query);
    };
    window.addEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, onContextSearch);
    return () => window.removeEventListener(ASSISTANT_CONTEXT_SEARCH_EVENT, onContextSearch);
  }, []);

  useEffect(() => {
    if (catalogViewTracked.current) return;
    catalogViewTracked.current = true;
    const initial = initialFacetState.current;
    trackPrinterEvent("printer_catalog_view", {
      facets_active: activeFacetNames(initial),
      sort: initial.sort,
      source: catalogViewSource(),
    });
  }, []);

  // Состояние фасетов — в URL (§10 «Готово когда»), но continual-драг слайдера/чипов не должен
  // спамить историю переходов navigate()/View Transition — правим адресную строку тихо.
  useEffect(() => {
    const target = `${window.location.pathname}${facetsToSearch(state)}`;
    if (target !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", target);
    }
  }, [state]);

  function setFacet<K extends keyof FacetState>(key: K, value: FacetState[K]) {
    const event = facetApplyEvent(key, value, state);
    if (event) trackPrinterEvent("printer_facet_apply", event);
    setState((s) => ({ ...s, [key]: value }));
  }

  const allPrinters = printers ?? [];
  const scopedPrinters = catalogView ? allPrinters.filter((p) => p.status === "announced" || p.status === "rumored") : allPrinters;
  const filtered = applyFacets(scopedPrinters, state);
  const gap = printers ? computeGap(scopedPrinters, state) : null;
  const gapPrinters = gap
    ? gap.capabilityKey != null
      ? applyFacets(scopedPrinters, { ...state, capabilities: state.capabilities.filter((k) => k !== gap.capabilityKey) })
      : applyFacets(scopedPrinters, state, [gap.family])
    : [];
  const gapTail = gap ? gapPrinters.filter((p) => !filtered.includes(p)) : [];
  const visible = catalogView && !state.sort ? sortPrinters(filtered, { ...state, sort: "new" }) : sortPrinters(filtered, state);
  const filtersActive = hasActiveFilters(state);
  const addPrinterHref = isResearcher
    ? researchNewPath(state.q || undefined)
    : issueNewPath({ title: "Хочу заполнять каталог принтеров", category: "researcher-access" });

  const compareSelected = allPrinters.filter((p) => compare.has(p.id));

  function resetAll() {
    setState(emptyFacetState());
    setQInput("");
  }

  // Самый узкий активный фильтр (§2.10) — приблизительно: семья, снятие которой даёт наибольший
  // прирост числа результатов.
  const narrowestRelief = useMemo(() => findNarrowestRelief(scopedPrinters, state), [scopedPrinters, state]);

  return (
    <div className="home">
      <AuroraBackground />
      {renderHeader ? (
        <div style={{ position: "relative", zIndex: 30 }}>
          <HomeHeader user={user} printers={activation.printers} section={section} onSectionChange={onSectionChange} mode={headerModeFor("printers")} />
        </div>
      ) : null}
      <main
        className="homeContent homeWorkspaceBody"
        style={swipe.dragX !== 0 ? { transform: `translateX(${swipe.dragX}px)` } : undefined}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
      >
        <FleetBar printers={activation.printers} />

        <div className="prnToggleRow">
          <SegmentToggle
            ariaLabel="Каталог или новинки"
            value={catalogView ? "new" : "catalog"}
            onChange={(next) => {
              sound.toggle();
              // Таб меняет выдачу внутри уже отрисованной оболочки: шапка, фильтры и сеточный
              // контейнер остаются на месте, поэтому переключение не вызывает layout shift.
              setCatalogView(next === "new");
            }}
            options={[
              { value: "catalog", label: "Каталог" },
              { value: "new", label: "Новинки" },
            ]}
          />
          <nav className="prnRelatedCatalogs" aria-label="Связанные каталоги">
            <a
              className="prnRelatedCatalogLink pressable"
              href={materialsPath()}
              onClick={(event) => {
                event.preventDefault();
                navigate(materialsPath());
              }}
            >
              Филаменты
            </a>
          </nav>
        </div>

        <div className="prnMobileBar">
          <button type="button" className="prnMobileFilterBtn pressable" onClick={() => setMobileFiltersOpen(true)}>
            Фильтры{activeFilterCount(state) > 0 ? ` (${activeFilterCount(state)})` : ""}
          </button>
        </div>

        <div className="prnLayout">
          <aside className="prnSidebar">
            <FacetSidebar
              allPrinters={allPrinters}
              loading={printers === null}
              state={state}
              setFacet={setFacet}
              brandsExpanded={brandsExpanded}
              setBrandsExpanded={setBrandsExpanded}
              moreFiltersOpen={moreFiltersOpen}
              setMoreFiltersOpen={setMoreFiltersOpen}
              filtersActive={filtersActive}
              onReset={resetAll}
            />
          </aside>

          <div className="prnContent">
            {loadError ? <div className="prnLoadError">Каталог не отвечает. Обновить</div> : null}

            {printers === null ? (
              <SkeletonGrid />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<SearchIcon />}
                title="Ничего не нашлось по этим фильтрам"
                sub={printers.length === 0 ? "В каталоге пока нет принтеров — агенты добавляют новые каждый день." : undefined}
                action={
                  <div className="prnEmptyActions">
                    {narrowestRelief ? (
                      <button
                        type="button"
                        className="prnEmptySuggestChip pressable"
                        onClick={() => {
                          sound.tick();
                          setState(narrowestRelief.nextState);
                          setQInput(narrowestRelief.nextState.q);
                        }}
                      >
                        Снять «{narrowestRelief.label}» (вернёт {narrowestRelief.count})
                      </button>
                    ) : null}
                    <div className="prnEmptySecondary">
                      {user ? (
                        <a
                          href={addPrinterHref}
                          onClick={(event) => {
                            event.preventDefault();
                            sound.tick();
                            navigate(addPrinterHref);
                          }}
                        >
                          Не нашли свой принтер? Добавьте →
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            sound.tick();
                            promptGuestLogin();
                          }}
                        >
                          Не нашли свой принтер? Добавьте →
                        </button>
                      )}
                    </div>
                  </div>
                }
              />
            ) : (
              <>
                {allPrinters.length > 0 && allPrinters.length < 6 ? (
                  <div className="prnCatalogHint">В каталоге {allPrinters.length} принтеров — агенты добавляют новые каждый день.</div>
                ) : null}
                <div className="prnGrid">
                  {visible.map((printer, index) => (
                    <PrinterTile
                      key={printer.id}
                      printer={printer}
                      index={index}
                      currency={state.currency}
                      todayMs={todayMs}
                      contextCapability={activeContextCapability(state)}
                      compareSelected={compare.has(printer.id)}
                      compareDisabled={compare.full}
                      onToggleCompare={() => compare.toggle(printer.id)}
                      onOpen={() => markPrinterCardSource("catalog")}
                    />
                  ))}
                  {gapExpanded && gapTail.length > 0 ? (
                    <div className="prnGapTail">
                      <div className="prnGapTailLabel">Без данных о «{gap!.field}»</div>
                      <div className="prnGrid">
                        {gapTail.map((printer, index) => (
                          <PrinterTile
                            key={printer.id}
                            printer={printer}
                            index={index}
                            currency={state.currency}
                            todayMs={todayMs}
                            compareSelected={compare.has(printer.id)}
                            compareDisabled={compare.full}
                            onToggleCompare={() => compare.toggle(printer.id)}
                            onOpen={() => markPrinterCardSource("catalog")}
                            muted
                            gapField={gap!.field}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                {gap ? (
                  <GapRow
                    field={gap.field}
                    count={gap.count}
                    expanded={gapExpanded}
                    onToggle={() => setGapExpanded((v) => !v)}
                    isResearcher={isResearcher}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </main>

      <ComparePanel selected={compareSelected} onRemove={compare.remove} />

      {mobileFiltersOpen ? (
        <MobileFilterSheet onClose={() => setMobileFiltersOpen(false)} resultCount={visible.length}>
          <FacetSidebar
            allPrinters={allPrinters}
            loading={printers === null}
            state={state}
            setFacet={setFacet}
            brandsExpanded={brandsExpanded}
            setBrandsExpanded={setBrandsExpanded}
            moreFiltersOpen={moreFiltersOpen}
            setMoreFiltersOpen={setMoreFiltersOpen}
            filtersActive={filtersActive}
            onReset={resetAll}
          />
        </MobileFilterSheet>
      ) : null}
    </div>
  );
}

function FleetBar({ printers }: { printers: { id: string; brand: string; model: string }[] }) {
  if (printers.length === 0) {
    return (
      <div className="prnFleetEmpty">
        <a className="uiButton pressable prnBindPrinter" data-variant="secondary" href={parkAddPath()} onClick={(event) => { event.preventDefault(); navigate(parkAddPath()); }}>
          <PrinterIcon size={16} />
          Привязать принтер
        </a>
      </div>
    );
  }
  return (
    <div className="prnFleetBar">
      {printers.slice(0, 6).map((printer) => (
        <span key={printer.id} className="prnFleetChip">
          {printer.brand} {printer.model}
        </span>
      ))}
    </div>
  );
}

interface FacetSidebarProps {
  allPrinters: PrinterRecord[];
  loading: boolean;
  state: FacetState;
  setFacet: <K extends keyof FacetState>(key: K, value: FacetState[K]) => void;
  brandsExpanded: boolean;
  setBrandsExpanded: (v: boolean) => void;
  moreFiltersOpen: boolean;
  setMoreFiltersOpen: (v: boolean) => void;
  filtersActive: boolean;
  onReset: () => void;
}

function FacetSidebar({
  allPrinters,
  loading,
  state,
  setFacet,
  filtersActive,
  onReset,
  brandsExpanded,
  setBrandsExpanded,
  moreFiltersOpen,
  setMoreFiltersOpen,
}: FacetSidebarProps) {
  const sound = useInteractionSound();
  const brands = brandCounts(allPrinters, state);
  const shownBrands = brandsExpanded ? brands : brands.slice(0, BRAND_TOP_COUNT);
  const priceBounds = useMemo(() => priceRange(allPrinters, state.currency), [allPrinters, state.currency]);
  const activeMoreFilters = countMoreFilters(state);
  const materialOptions = useMemo(() => Array.from(new Set(allPrinters.flatMap((p) => p.materials_supported))).sort(), [allPrinters]);

  return (
    <>
      <div className="prnFacetSection">
        <Eyebrow>Бренд</Eyebrow>
        <div className="prnBrandList">
          {loading
            ? Array.from({ length: BRAND_TOP_COUNT }, (_, index) => <span key={index} className="prnFacetSkeletonRow" aria-hidden="true" />)
            : shownBrands.map(({ brand, count, zero }) => (
            <button
              key={brand}
              type="button"
              className="prnBrandRow pressable"
              data-selected={state.brands.includes(brand) || undefined}
              data-zero={zero || undefined}
              disabled={zero && !state.brands.includes(brand)}
              onClick={() => {
                sound.toggle();
                setFacet("brands", toggleValue(state.brands, brand));
              }}
            >
              <span>{brand}</span>
              <span className="prnBrandCount">({count})</span>
            </button>
            ))}
        </div>
        {!loading && brands.length > BRAND_TOP_COUNT ? (
          <button type="button" className="prnBrandShowAll pressable" onClick={() => setBrandsExpanded(!brandsExpanded)}>
            {brandsExpanded ? "Свернуть" : "Показать все бренды →"}
          </button>
        ) : null}
      </div>

      <div className="prnFacetSection">
        <Eyebrow>Цена</Eyebrow>
        <div className="prnPriceGroup">
          <SegmentToggle
            ariaLabel="Валюта"
            value={state.currency}
            onChange={(next) => {
              sound.toggle();
              setFacet("currency", next);
              setFacet("priceMin", null);
              setFacet("priceMax", null);
            }}
            options={[
              { value: "rub", label: "₽" },
              { value: "usd", label: "$" },
            ]}
          />
          <RangeSlider
            min={priceBounds.min}
            max={priceBounds.max}
            valueMin={state.priceMin ?? priceBounds.min}
            valueMax={state.priceMax ?? priceBounds.max}
            onChange={(min, max) => {
              setFacet("priceMin", min);
              setFacet("priceMax", max);
            }}
            formatValue={(v) => (state.currency === "rub" ? `${Math.round(v).toLocaleString("ru-RU")} ₽` : `$${Math.round(v)}`)}
          />
        </div>
      </div>

      <div className="prnFacetSection">
        <Eyebrow>Влезет деталь</Eyebrow>
        <div className="prnFitRow">
          <input className="prnFitInput" type="number" placeholder="X" value={state.fitX ?? ""} onChange={(e) => setFacet("fitX", e.target.value ? Number(e.target.value) : null)} />
          <span className="prnFitTimes">×</span>
          <input className="prnFitInput" type="number" placeholder="Y" value={state.fitY ?? ""} onChange={(e) => setFacet("fitY", e.target.value ? Number(e.target.value) : null)} />
          <span className="prnFitTimes">×</span>
          <input className="prnFitInput" type="number" placeholder="Z" value={state.fitZ ?? ""} onChange={(e) => setFacet("fitZ", e.target.value ? Number(e.target.value) : null)} />
          <span className="prnFitUnit">мм</span>
        </div>
        <div className="prnFitPresets">
          {FIT_PRESETS.map((preset) => (
            <Chip
              key={preset}
              selected={state.fitX === preset && state.fitY === preset && state.fitZ === preset}
              onClick={() => {
                sound.toggle();
                setFacet("fitX", preset);
                setFacet("fitY", preset);
                setFacet("fitZ", preset);
              }}
            >
              ≥{preset}³
            </Chip>
          ))}
        </div>
      </div>

      <div className="prnFacetSection">
        <Eyebrow>Тип</Eyebrow>
        <div className="prnChipRow">
          {(["fdm", "resin"] as const).map((kind) => (
            <Chip
              key={kind}
              selected={state.kind === kind}
              onClick={() => {
                sound.toggle();
                setFacet("kind", state.kind === kind ? null : kind);
              }}
            >
              {kind === "fdm" ? "FDM" : "Резин"}
            </Chip>
          ))}
        </div>
        <Eyebrow>Кинематика</Eyebrow>
        <div className="prnChipRow">
          {KINEMATICS_ORDER.map((key) => {
            const zero = wouldBeEmpty(allPrinters, state, "kinematics", { ...state, kinematics: toggleValue(state.kinematics, key) }) && !state.kinematics.includes(key);
            return (
              <Chip
                key={key}
                selected={state.kinematics.includes(key)}
                onClick={() => {
                  if (zero) return;
                  sound.toggle();
                  setFacet("kinematics", toggleValue(state.kinematics, key));
                }}
              >
                <span className={zero ? "prnZero" : undefined}>{kinematicsLabel(key)}</span>
              </Chip>
            );
          })}
        </div>
      </div>

      <div className="prnFacetSection">
        <Eyebrow>Возможности</Eyebrow>
        <div className="prnChipGrid">
          {CAPABILITY_ORDER.map((key) => {
            const zero = wouldBeEmpty(allPrinters, state, "capabilities", { ...state, capabilities: toggleValue(state.capabilities, key) }) && !state.capabilities.includes(key);
            return (
              <Chip
                key={key}
                selected={state.capabilities.includes(key)}
                onClick={() => {
                  if (zero) return;
                  sound.toggle();
                  setFacet("capabilities", toggleValue(state.capabilities, key));
                }}
              >
                <span className={zero ? "prnZero" : undefined}>{CAPABILITY_LABEL[key]}</span>
              </Chip>
            );
          })}
        </div>
      </div>

      <div className="prnAccordion" data-open={moreFiltersOpen || undefined}>
        <button type="button" className="prnAccordionHeader pressable" aria-expanded={moreFiltersOpen} onClick={() => setMoreFiltersOpen(!moreFiltersOpen)}>
          <span>Ещё фильтры{activeMoreFilters > 0 ? ` · ${activeMoreFilters}` : ""}</span>
          <span className="prnAccordionChevron">▸</span>
        </button>
        {moreFiltersOpen ? (
          <div className="prnAccordionBody reveal">
            <NumberFilter label="Хотэнд ≥ °C" value={state.hotendMinC} onChange={(v) => setFacet("hotendMinC", v)} />
            <NumberFilter label="Стол ≥ °C" value={state.bedMinC} onChange={(v) => setFacet("bedMinC", v)} />
            <NumberFilter label="Поток мм³/с ≥" value={state.flowMin} onChange={(v) => setFacet("flowMin", v)} />
            <NumberFilter label="Скорость мм/с ≥" value={state.speedMin} onChange={(v) => setFacet("speedMin", v)} />
            <Chip selected={state.swappableNozzle} onClick={() => { sound.toggle(); setFacet("swappableNozzle", !state.swappableNozzle); }}>
              Сменное сопло
            </Chip>
            <div>
              <Eyebrow>Материалы</Eyebrow>
              <p className="prnMaterialsHint">фильтр по всем выбранным сразу</p>
              <div className="prnChipRow">
                {materialOptions.map((material) => (
                  <Chip key={material} selected={state.materials.includes(material)} onClick={() => { sound.toggle(); setFacet("materials", toggleValue(state.materials, material)); }}>
                    {material}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Eyebrow>Коннективность</Eyebrow>
              <div className="prnChipRow">
                {CONNECTIVITY_ORDER.map((key) => (
                  <Chip key={key} selected={state.connectivity.includes(key)} onClick={() => { sound.toggle(); setFacet("connectivity", toggleValue(state.connectivity, key)); }}>
                    {CONNECTIVITY_LABEL[key]}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Eyebrow>Статус</Eyebrow>
              <div className="prnChipRow">
                {STATUS_ORDER.map((key) => (
                  <Chip key={key} selected={state.status.includes(key)} onClick={() => { sound.toggle(); setFacet("status", toggleValue(state.status, key)); }}>
                    {STATUS_LABEL[key]}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Eyebrow>Поддержка</Eyebrow>
              <div className="prnChipRow">
                {SUPPORT_LEVEL_ORDER.map((key) => (
                  <Chip key={key} selected={state.supportLevel.includes(key)} onClick={() => { sound.toggle(); setFacet("supportLevel", toggleValue(state.supportLevel, key)); }}>
                    {SUPPORT_LEVEL_LABEL[key]}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {filtersActive ? (
        <button type="button" className="prnBrandShowAll pressable" onClick={onReset}>
          Сбросить фильтры ✕
        </button>
      ) : null}
    </>
  );
}

function NumberFilter({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="prnNumberFilterRow">
      <span>{label}</span>
      <input
        className="prnNumberFilterInput"
        type="number"
        placeholder="от"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      />
    </div>
  );
}

function MobileFilterSheet({ children, onClose, resultCount }: { children: ReactNode; onClose: () => void; resultCount: number }) {
  return (
    <div className="prnSheetBackdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="prnSheet" data-visible="true" role="dialog" aria-modal="true" aria-label="Фильтры">
        <div className="prnSheetHead">
          <span>Фильтры</span>
          <button type="button" className="ovlModalClose pressable" aria-label="Закрыть" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="prnSheetBody">{children}</div>
        <div className="prnSheetFooter">
          <button type="button" className="uiButton pressable" data-variant="primary" onClick={onClose}>
            <span>Показать {resultCount} принтеров</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="prnSkeletonGrid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="prnSkeletonTile">
          <div className="prnSkeletonPhoto" />
          <div className="prnSkeletonLines">
            <div className="prnSkeletonLine" style={{ width: "50%" }} />
            <div className="prnSkeletonLine" style={{ width: "80%" }} />
            <div className="prnSkeletonLine" style={{ width: "40%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// --- вспомогательные чистые функции экрана (не общие для фасетов — узко под разметку) ---

function kinematicsLabel(key: string): string {
  return KINEMATICS_OPTIONS.find((o) => o.value === key)?.label ?? key;
}

function activeContextCapability(state: FacetState): CapabilityKey | null {
  return state.capabilities[0] ?? null;
}

function hasActiveFilters(state: FacetState): boolean {
  return (
    state.q !== "" ||
    state.brands.length > 0 ||
    state.priceMin != null ||
    state.priceMax != null ||
    state.fitX != null ||
    state.fitY != null ||
    state.fitZ != null ||
    state.kind != null ||
    state.kinematics.length > 0 ||
    state.capabilities.length > 0 ||
    state.hotendMinC != null ||
    state.bedMinC != null ||
    state.flowMin != null ||
    state.speedMin != null ||
    state.swappableNozzle ||
    state.materials.length > 0 ||
    state.connectivity.length > 0 ||
    state.status.length > 0 ||
    state.supportLevel.length > 0
  );
}

function activeFilterCount(state: FacetState): number {
  let n = 0;
  if (state.brands.length) n++;
  if (state.priceMin != null || state.priceMax != null) n++;
  if (state.fitX != null || state.fitY != null || state.fitZ != null) n++;
  if (state.kind != null) n++;
  if (state.kinematics.length) n++;
  if (state.capabilities.length) n++;
  n += countMoreFilters(state);
  return n;
}

function activeFacetNames(state: FacetState): string[] {
  const active: string[] = [];
  if (state.q) active.push("search");
  if (state.brands.length) active.push("brand");
  if (state.priceMin != null || state.priceMax != null) active.push("price");
  if (state.fitX != null || state.fitY != null || state.fitZ != null) active.push("build_volume");
  if (state.kind) active.push("type");
  if (state.kinematics.length) active.push("kinematics");
  if (state.capabilities.length) active.push("capabilities");
  if (state.hotendMinC != null) active.push("hotend");
  if (state.bedMinC != null) active.push("bed");
  if (state.materials.length) active.push("materials");
  if (state.connectivity.length) active.push("connectivity");
  if (state.status.length) active.push("status");
  if (state.supportLevel.length) active.push("support_level");
  return active;
}

function facetApplyEvent<K extends keyof FacetState>(
  key: K,
  value: FacetState[K],
  state: FacetState,
): { facet: string; value: unknown } | null {
  switch (key) {
    case "fitX":
    case "fitY":
    case "fitZ":
      return {
        facet: "build_volume",
        value: {
          x: key === "fitX" ? value : state.fitX,
          y: key === "fitY" ? value : state.fitY,
          z: key === "fitZ" ? value : state.fitZ,
        },
      };
    case "priceMin":
    case "priceMax":
      return {
        facet: "price",
        value: {
          min: key === "priceMin" ? value : state.priceMin,
          max: key === "priceMax" ? value : state.priceMax,
          currency: state.currency,
        },
      };
    case "hotendMinC":
      return { facet: "hotend", value };
    case "bedMinC":
      return { facet: "bed", value };
    case "kinematics":
      return { facet: "kinematics", value };
    case "materials":
      return { facet: "materials", value };
    case "connectivity":
      return { facet: "connectivity", value };
    case "capabilities": {
      const next = value as CapabilityKey[];
      const changed = next.find((capability) => !state.capabilities.includes(capability)) ?? state.capabilities.find((capability) => !next.includes(capability));
      if (changed === "ams") return { facet: "multimaterial", value: next.includes(changed) };
      if (changed === "laser") return { facet: "toolhead_extras", value: next.includes(changed) };
      return null;
    }
    default:
      return null;
  }
}

function countMoreFilters(state: FacetState): number {
  let n = 0;
  if (state.hotendMinC != null) n++;
  if (state.bedMinC != null) n++;
  if (state.flowMin != null) n++;
  if (state.speedMin != null) n++;
  if (state.swappableNozzle) n++;
  if (state.materials.length) n++;
  if (state.connectivity.length) n++;
  if (state.status.length) n++;
  if (state.supportLevel.length) n++;
  return n;
}

function priceRange(printers: PrinterRecord[], currency: "rub" | "usd"): { min: number; max: number } {
  const values = printers
    .map((p) => (currency === "rub" ? (p.price as Record<string, unknown>).ru_rub : (p.price as Record<string, unknown>).msrp_usd))
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return { min: 0, max: 1000 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

interface Relief {
  label: string;
  count: number;
  nextState: FacetState;
}

// §2.10: предлагаем снять САМЫЙ УЗКИЙ активный фильтр — тот, что даёт наибольший прирост при снятии.
function findNarrowestRelief(all: PrinterRecord[], state: FacetState): Relief | null {
  const current = applyFacets(all, state).length;
  const candidates: { label: string; family: FamilyKey; next: FacetState }[] = [];
  if (state.q.trim()) candidates.push({ label: "Поиск", family: "q", next: { ...state, q: "" } });
  if (state.brands.length) candidates.push({ label: "Бренд", family: "brands", next: { ...state, brands: [] } });
  if (state.priceMin != null || state.priceMax != null) candidates.push({ label: "Цена", family: "price", next: { ...state, priceMin: null, priceMax: null } });
  if (state.fitX != null || state.fitY != null || state.fitZ != null) candidates.push({ label: "Влезет деталь", family: "buildVolume", next: { ...state, fitX: null, fitY: null, fitZ: null } });
  if (state.kind != null) candidates.push({ label: state.kind === "fdm" ? "FDM" : "Резин", family: "kind", next: { ...state, kind: null } });
  if (state.kinematics.length) candidates.push({ label: "Кинематика", family: "kinematics", next: { ...state, kinematics: [] } });
  if (state.capabilities[0]) candidates.push({ label: CAPABILITY_LABEL[state.capabilities[0]], family: "capabilities", next: { ...state, capabilities: [] } });
  if (state.status.length) candidates.push({ label: "Статус", family: "status", next: { ...state, status: [] } });
  if (state.supportLevel.length) candidates.push({ label: "Поддержка", family: "supportLevel", next: { ...state, supportLevel: [] } });
  if (state.materials.length) candidates.push({ label: "Материалы", family: "materials", next: { ...state, materials: [] } });

  let best: Relief | null = null;
  for (const candidate of candidates) {
    const count = applyFacets(all, candidate.next).length - current;
    if (count > 0 && (best == null || count > best.count)) {
      best = { label: candidate.label, count, nextState: candidate.next };
    }
  }
  return best;
}
