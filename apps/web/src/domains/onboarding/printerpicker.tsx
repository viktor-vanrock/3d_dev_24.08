import { useEffect, useRef, useState } from "react";
import {
  fetchPopularMachines,
  searchMachines,
  trackActivation,
  type CatalogMachine,
  type ActivationState,
  type PrinterPatch,
  type Persona,
  type UserPrinter,
} from "@shared/lib";
import { Button, Card, Chip, Eyebrow, Input } from "@shared/ui";

// Picker принтера — полный флоу привязки (эпик MF-437 § «Вопрос «есть ли принтер?»»):
// популярные чипы (MF-32) → поиск бренд/модель → «не нашёл» → ручной ввод (verified=false,
// сигнал спроса в MF-32). Переиспользуется и в first-run флоу, и повторным открытием из
// чек-листа активации (MF-40 Checklist onStep) — оба места передают addPrinter/onDone/onSkip.

const SEARCH_DEBOUNCE_MS = 250;

// Каталог MF-32 (bootstrap-импорт MF-405) часто уже несёт бренд ВНУТРИ `model` (например
// model="Prusa CORE One", "Bambu Lab A1 mini" при vendor.name="Prusa Research"/"Bambu Lab") —
// живая проверка на dev.3mf.tech (MF-437) показала, что `${brand} ${model}` дублирует бренд
// в чипе («Prusa Research Prusa CORE One»). Показываем бренд только если модель его ещё не
// содержит.
// Экспортирована — тот же дедуп нужен строкам «Мои принтеры» в ЛК (market/profile.tsx,
// MF-359): `user_printers.model`/`brand` та же пара полей, что CatalogMachine.
export function printerLabel(machine: { brand: string; model: string }): string {
  if (machine.brand && machine.model.toLowerCase().includes(machine.brand.toLowerCase())) return machine.model;
  return `${machine.brand} ${machine.model}`.trim();
}

export function PrinterPicker({
  persona,
  addPrinter,
  onLinked,
  onSkip,
  headingLevel,
  searchInputClassName,
  surface = "card",
}: {
  persona: Persona | null;
  addPrinter: ActivationState["addPrinter"];
  onLinked: () => void;
  onSkip?: () => void;
  headingLevel?: 1;
  searchInputClassName?: string;
  // В онбординге форма живёт в Card, а в overlay сама панель уже является поверхностью.
  surface?: "card" | "overlay";
}) {
  const [popular, setPopular] = useState<CatalogMachine[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogMachine[]>([]);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [popularState, setPopularState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Один раз при открытии, вне зависимости от того, кто позвал picker (first-run/чек-лист/
  // soft-track, см. коммент выше) — единая точка эмиссии, не дублируем на каждом callsite.
  useEffect(() => {
    trackActivation("printer_picker_open");
  }, []);

  async function loadPopular() {
    setPopularState("loading");
    try {
      const machines = await fetchPopularMachines();
      setPopular(machines);
      setPopularState(machines.length > 0 ? "ready" : "empty");
    } catch {
      setPopular([]);
      setPopularState("error");
    }
  }

  useEffect(() => {
    void loadPopular();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearchState("idle");
      return;
    }
    setSearchState("loading");
    debounceRef.current = setTimeout(() => {
      searchMachines(query).then((machines) => {
        setResults(machines);
        setSearchState(machines.length > 0 ? "ready" : "empty");
      }).catch(() => {
        setResults([]);
        setSearchState("error");
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function linkCatalogMachine(machine: CatalogMachine, source: "popular" | "search") {
    if (busy) return;
    setBusy(true);
    await addPrinter({ brand: machine.brand, model: machine.model, link_source: source, printer_id: machine.id });
    setBusy(false);
    trackActivation("printer_linked", { link_source: source });
    onLinked();
  }

  const content = (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {headingLevel === 1 ? <h1 style={{ margin: 0, fontSize: 17, fontWeight: 500 }}>Какой у вас принтер?</h1> : <div style={{ fontSize: 17 }}>Какой у вас принтер?</div>}
        {onSkip ? (
          <Button variant="secondary" icon={<LaterIcon />} style={{ alignSelf: "auto" }} onClick={onSkip}>
            Позже
          </Button>
        ) : null}
      </div>

      {popularState === "loading" ? <p role="status" className="homePickerNotice">Загружаем популярные модели…</p> : null}
      {popularState === "error" ? (
        <div className="homePickerNotice" role="alert">
          <p>Не удалось загрузить каталог принтеров.</p>
          <button type="button" className="uiButton pressable" data-variant="secondary" onClick={() => void loadPopular()}>
            Повторить
          </button>
        </div>
      ) : null}
      {popularState === "empty" ? <p className="homePickerNotice">Популярных моделей пока нет — найдите принтер через поиск.</p> : null}
      {popular.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Популярные</Eyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {popular.map((machine) => (
              <Chip key={machine.id} onClick={() => linkCatalogMachine(machine, "popular")}>
                {printerLabel(machine)}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Input
          className={searchInputClassName}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти бренд или модель"
          aria-label="Поиск принтера"
        />
        {searchState === "loading" ? <p role="status" className="homePickerNotice">Ищем модель…</p> : null}
        {searchState === "empty" ? <p className="homePickerNotice">Ничего не нашли. Попробуйте другой запрос или укажите модель вручную.</p> : null}
        {searchState === "error" ? <p role="alert" className="homePickerNotice">Поиск временно недоступен. Попробуйте ещё раз.</p> : null}
        {results.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {results.map((machine) => (
              <Chip key={machine.id} onClick={() => linkCatalogMachine(machine, "search")}>
                {printerLabel(machine)}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      {manual ? (
        <ManualPrinterForm persona={persona} addPrinter={addPrinter} onDone={onLinked} />
      ) : (
        <Button
          variant="secondary"
          icon={<EditIcon />}
          style={{ alignSelf: "flex-start" }}
          onClick={() => {
            trackActivation("printer_not_found_manual");
            setManual(true);
          }}
        >
          Не нашли? Указать вручную
        </Button>
      )}
    </>
  );

  return surface === "overlay" ? <div className="ovlModalContent">{content}</div> : <Card style={{ padding: "clamp(18px, 3.5vw, 28px)", display: "flex", flexDirection: "column", gap: 14 }}>{content}</Card>;
}

function LaterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 7v5l3 2m6-2a9 9 0 1 1-3.2-6.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 3v4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// Общий набор полей принтера (Бренд/Модель/X/Y/Z/Сопло/Кинематика), общий и для добавления
// (ManualPrinterForm), и для редактирования (PrinterEditForm, MF-939 §2/§7 — «вынести поля в
// переиспользуемый под create/edit вид», не изобретаем вторую форму принтера). `lockBrandModel`
// — каталожная запись: Бренд/Модель показаны, но не редактируются (спека §2).
interface PrinterFieldValues {
  brand: string;
  model: string;
  x: string;
  y: string;
  z: string;
  nozzle: string;
  kinematics: string;
}

function PrinterFieldGrid({
  values,
  onChange,
  lockBrandModel,
  showKinematics,
}: {
  values: PrinterFieldValues;
  onChange: (patch: Partial<PrinterFieldValues>) => void;
  lockBrandModel: boolean;
  showKinematics: boolean;
}) {
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {lockBrandModel ? (
          <>
            <span className="printerFieldLocked">{values.brand}</span>
            <span className="printerFieldLocked">{values.model}</span>
          </>
        ) : (
          <>
            <Input
              value={values.brand}
              onChange={(e) => onChange({ brand: e.target.value })}
              placeholder="Бренд"
              aria-label="Бренд"
              style={{ flex: 1, minWidth: 140 }}
            />
            <Input
              value={values.model}
              onChange={(e) => onChange({ model: e.target.value })}
              placeholder="Модель"
              aria-label="Модель"
              style={{ flex: 1, minWidth: 140 }}
            />
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Input value={values.x} onChange={(e) => onChange({ x: e.target.value })} placeholder="X мм" aria-label="X мм" inputMode="numeric" style={{ width: 90 }} />
        <Input value={values.y} onChange={(e) => onChange({ y: e.target.value })} placeholder="Y мм" aria-label="Y мм" inputMode="numeric" style={{ width: 90 }} />
        <Input value={values.z} onChange={(e) => onChange({ z: e.target.value })} placeholder="Z мм" aria-label="Z мм" inputMode="numeric" style={{ width: 90 }} />
        <Input
          value={values.nozzle}
          onChange={(e) => onChange({ nozzle: e.target.value })}
          placeholder="Сопло мм"
          aria-label="Сопло мм"
          inputMode="decimal"
          style={{ width: 100 }}
        />
      </div>
      {showKinematics ? (
        <Input
          value={values.kinematics}
          onChange={(e) => onChange({ kinematics: e.target.value })}
          placeholder="Кинематика (CoreXY, Voron…)"
          aria-label="Кинематика"
        />
      ) : null}
    </>
  );
}

function ManualPrinterForm({
  persona,
  addPrinter,
  onDone,
}: {
  persona: Persona | null;
  addPrinter: ActivationState["addPrinter"];
  onDone: () => void;
}) {
  const [values, setValues] = useState<PrinterFieldValues>({ brand: "", model: "", x: "", y: "", z: "", nozzle: "", kinematics: "" });
  const [busy, setBusy] = useState(false);

  const canSubmit = values.brand.trim().length > 0 && values.model.trim().length > 0;

  function patchValues(patch: Partial<PrinterFieldValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    const { brand, model, x, y, z, nozzle, kinematics } = values;
    const buildVolume = x && y && z ? { x: Number(x), y: Number(y), z: Number(z) } : undefined;
    await addPrinter({
      brand: brand.trim(),
      model: model.trim(),
      link_source: "manual",
      ...(buildVolume ? { build_volume: buildVolume } : {}),
      ...(nozzle ? { nozzle_mm: Number(nozzle) } : {}),
      ...(persona === "builder" && kinematics ? { kinematics: kinematics.trim() } : {}),
    });
    setBusy(false);
    trackActivation("printer_linked", { link_source: "manual" });
    onDone();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <PrinterFieldGrid values={values} onChange={patchValues} lockBrandModel={false} showKinematics={persona === "builder"} />
      <Button variant="secondary" icon={null} disabled={!canSubmit || busy} onClick={submit}>
        Сохранить принтер
      </Button>
    </div>
  );
}

// Модалка «Изменить принтер» (MF-939 §2): каталожная запись (verified) — Бренд/Модель
// приглушены и нередактируемы (провенанс привязки, ломать её вручную нельзя), правится только
// физика конкретного экземпляра. Кинематика показана всегда (не гейтится persona, в отличие от
// формы добавления — здесь это уже существующая запись, а не первичный ввод «под персону»).
// «Сделать основным» — отдельное немедленное действие (спека §2), не часть «Сохранить».
export function PrinterEditForm({
  printer,
  onSave,
  onMakePrimary,
}: {
  printer: UserPrinter;
  onSave: (patch: PrinterPatch) => Promise<void>;
  onMakePrimary?: () => Promise<void>;
}) {
  const locked = printer.verified;
  const [values, setValues] = useState<PrinterFieldValues>({
    brand: printer.brand,
    model: printer.model,
    x: printer.build_volume ? String(printer.build_volume.x) : "",
    y: printer.build_volume ? String(printer.build_volume.y) : "",
    z: printer.build_volume ? String(printer.build_volume.z) : "",
    nozzle: printer.nozzle_mm != null ? String(printer.nozzle_mm) : "",
    kinematics: printer.kinematics ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [primaryBusy, setPrimaryBusy] = useState(false);

  const canSubmit = locked || (values.brand.trim().length > 0 && values.model.trim().length > 0);

  function patchValues(patch: Partial<PrinterFieldValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    const { brand, model, x, y, z, nozzle, kinematics } = values;
    const buildVolume = x && y && z ? { x: Number(x), y: Number(y), z: Number(z) } : undefined;
    await onSave({
      ...(locked ? {} : { brand: brand.trim(), model: model.trim() }),
      ...(buildVolume ? { build_volume: buildVolume } : {}),
      ...(nozzle ? { nozzle_mm: Number(nozzle) } : {}),
      kinematics: kinematics.trim(),
    });
    setBusy(false);
  }

  async function makePrimary() {
    if (!onMakePrimary || primaryBusy) return;
    setPrimaryBusy(true);
    await onMakePrimary();
    setPrimaryBusy(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <PrinterFieldGrid values={values} onChange={patchValues} lockBrandModel={locked} showKinematics />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Button variant="primary" icon={null} disabled={!canSubmit || busy} onClick={submit}>
          Сохранить
        </Button>
        {onMakePrimary ? (
          <Button variant="secondary" icon={null} disabled={primaryBusy} onClick={makePrimary}>
            Сделать основным
          </Button>
        ) : null}
      </div>
    </div>
  );
}
