import { Fragment, useEffect, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): printing→ai listPrinters/PrinterRecord (каталог принтеров читает исследовательскую базу), развязка отложена до pages/DI. См. MIGRATION.md.
import { listPrinters, type PrinterRecord } from "@domains/ai";
import { headerModeFor, navigate, printerPath, printersPath } from "../../../router.ts";
import { AuroraBackground, Button, EmptyState, PrinterIcon, Switch } from "@shared/ui";
import { useCompareSet } from "./comparestate.ts";
import "./printers.css";

// `/printers/compare?ids=…` (MF-927, nav.sections.md §3.5 — рамка не переоткрывается): 2–4
// станка, колонки, различающиеся строки подсвечены. Меньше двух выбрано — честная подсказка
// «выберите ещё один», не рендерим таблицу из одной колонки.

type CompareRow = { label: string; get: (p: PrinterRecord) => string };

const ROWS: CompareRow[] = [
  { label: "Статус", get: (p) => p.status },
  { label: "Кинематика", get: (p) => p.kinematics ?? "—" },
  { label: "Объём печати", get: (p) => buildVolumeLabel(p) },
  { label: "Хотэнд, °C", get: (p) => numOr(p.hotend, "max_temp_c") },
  { label: "Стол, °C", get: (p) => numOr(p.bed, "max_temp_c") },
  { label: "AMS/мультиматериал", get: (p) => (boolOr(p.multimaterial, "supported") ? "Да" : "Нет") },
  { label: "Закрытая камера", get: (p) => (p.enclosed ? "Да" : "Нет") },
  { label: "Цена, ₽", get: (p) => numOr(p.price, "ru_rub") },
];

function buildVolumeLabel(p: PrinterRecord): string {
  const bv = p.build_volume as Record<string, unknown>;
  if (typeof bv.x === "number" && typeof bv.y === "number" && typeof bv.z === "number") return `${bv.x}×${bv.y}×${bv.z}`;
  return "—";
}

function numOr(obj: unknown, key: string): string {
  const v = (obj as Record<string, unknown> | null)?.[key];
  return typeof v === "number" ? String(v) : "—";
}

function boolOr(obj: unknown, key: string): boolean {
  return (obj as Record<string, unknown> | null)?.[key] === true;
}

function renderCompareRow(row: CompareRow, selected: PrinterRecord[], differs: boolean, hasAddColumn: boolean) {
  return (
    <Fragment key={row.label}>
      <div className="prnCompareCell" data-head>
        {row.label}
      </div>
      {selected.map((printer) => (
        <div key={`${row.label}-${printer.id}`} className="prnCompareCell" data-diff={differs || undefined}>
          {row.get(printer)}
        </div>
      ))}
      {hasAddColumn ? <div className="prnCompareCell prnCompareAddPlaceholder" aria-hidden="true" /> : null}
    </Fragment>
  );
}

export function PrinterCompareScreen({
  user,
  section,
  onSectionChange,
  ids,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (s: Section) => void;
  ids: string[];
}) {
  const [printers, setPrinters] = useState<PrinterRecord[] | null>(null);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const compare = useCompareSet();

  useEffect(() => {
    let cancelled = false;
    void listPrinters().then((data) => {
      if (!cancelled) setPrinters(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = printers ? ids.map((id) => printers.find((p) => p.id === id)).filter((p): p is PrinterRecord => !!p) : [];
  const comparedRows = ROWS.map((row) => ({ row, differs: new Set(selected.map((printer) => row.get(printer))).size > 1 }));
  const visibleRows = onlyDifferences ? comparedRows.filter((item) => item.differs) : comparedRows;
  const canAddPrinter = selected.length < 4;
  const columnCount = selected.length + (canAddPrinter ? 1 : 0);

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} mode={headerModeFor("printer-compare")} />
      </div>
      <main className="homeContent">
        {printers === null ? null : selected.length < 2 ? (
          <EmptyState
            icon={<PrinterIcon size={28} />}
            title="Выберите ещё один принтер"
            sub="Сравнение показывает разницу между двумя–четырьмя моделями."
            action={
              <Button variant="secondary" onClick={() => navigate(printersPath())}>
                К каталогу
              </Button>
            }
          />
        ) : (
          <div className="prnCompare">
            <div className="prnCompareToolbar">
              <div className="prnCompareDifferences">
                <Switch checked={onlyDifferences} label="Только различия" onChange={() => setOnlyDifferences((value) => !value)} />
                <span>Только различия</span>
              </div>
            </div>
            <div className="prnCompareScroll">
              <div className="prnCompareTable" style={{ gridTemplateColumns: `minmax(132px, 160px) repeat(${columnCount}, minmax(180px, 1fr))` }}>
                <div className="prnCompareCell" data-head />
                {selected.map((printer) => (
                  <div key={printer.id} className="prnCompareCell prnComparePrinterHead" data-head>
                    <a href={printerPath(printer.slug)} onClick={(e) => { e.preventDefault(); navigate(printerPath(printer.slug)); }}>
                      {printer.brand} {printer.model}
                    </a>
                    <Button variant="ghost" icon={null} className="prnCompareRemove" aria-label={`Убрать ${printer.brand} ${printer.model} из сравнения`} onClick={() => compare.remove(printer.id)}>
                      ✕
                    </Button>
                  </div>
                ))}
                {canAddPrinter ? (
                  <a className="prnCompareAddPrinter pressable" href={printersPath()} aria-label="Добавить принтер к сравнению" onClick={(event) => { event.preventDefault(); navigate(printersPath()); }}>
                    <span className="prnCompareAddIcon" aria-hidden="true">+</span>
                    <span>Добавить принтер</span>
                  </a>
                ) : null}
                {visibleRows.map(({ row, differs }) => renderCompareRow(row, selected, differs, canAddPrinter))}
              </div>
            </div>
            {onlyDifferences && visibleRows.length === 0 ? <p className="prnCompareNoDiff">У выбранных моделей нет различий по этим характеристикам.</p> : null}
          </div>
        )}
      </main>
    </div>
  );
}
