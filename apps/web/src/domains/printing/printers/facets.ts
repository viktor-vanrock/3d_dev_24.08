// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): printing→ai PrinterRecord, развязка отложена до pages/DI. См. MIGRATION.md.
import type { PrinterRecord } from "@domains/ai";

// Логика фасетов каталога (docs/design/printers.catalog.md §2) — чистые функции, отдельно от
// разметки сайдбара (printersscreen.tsx), чтобы гашение нулевых опций (§2.8) и `GapRow` (§2.9)
// можно было прогнать юнит-тестами без рендера DOM.

export type Currency = "rub" | "usd";
export type PrinterKind = "fdm" | "resin";

export const CAPABILITY_KEYS = ["ams", "laser", "enclosed", "auto_leveling", "hardened", "moonraker", "lan_mode"] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export const KINEMATICS_KEYS = ["corexy", "cartesian", "delta", "idex", "scara", "polar", "belt"] as const;
export type KinematicsKey = (typeof KINEMATICS_KEYS)[number];

export const CONNECTIVITY_KEYS = ["wifi", "ethernet", "camera"] as const;
export type ConnectivityKey = (typeof CONNECTIVITY_KEYS)[number];

export const PRINTER_STATUS_KEYS = ["announced", "shipping", "eol", "rumored"] as const;
export type PrinterStatusKey = (typeof PRINTER_STATUS_KEYS)[number];

// Фасет поддержки (MF-892, docs/epics/printer.support.md §«Три уровня») — тот же словарь
// значений, что `printer.support_level` в схеме (docs/design/printer.face.md §1), только
// сам факт наличия/отсутствия у модели — фильтр каталога не решает, что делать с уровнем.
export const SUPPORT_LEVEL_KEYS = ["list", "managed", "custom"] as const;
export type SupportLevelKey = (typeof SUPPORT_LEVEL_KEYS)[number];

export type SortKey = "recommended" | "relevant" | "new" | "cheaper" | "pricier" | "build_volume";

export interface FacetState {
  q: string;
  brands: string[];
  currency: Currency;
  priceMin: number | null;
  priceMax: number | null;
  fitX: number | null;
  fitY: number | null;
  fitZ: number | null;
  kind: PrinterKind | null;
  kinematics: KinematicsKey[];
  capabilities: CapabilityKey[];
  hotendMinC: number | null;
  bedMinC: number | null;
  flowMin: number | null;
  speedMin: number | null;
  swappableNozzle: boolean;
  materials: string[];
  connectivity: ConnectivityKey[];
  status: PrinterStatusKey[];
  supportLevel: SupportLevelKey[];
  sort: SortKey;
}

export function emptyFacetState(): FacetState {
  return {
    q: "",
    brands: [],
    currency: "rub",
    priceMin: null,
    priceMax: null,
    fitX: null,
    fitY: null,
    fitZ: null,
    kind: null,
    kinematics: [],
    capabilities: [],
    hotendMinC: null,
    bedMinC: null,
    flowMin: null,
    speedMin: null,
    swappableNozzle: false,
    materials: [],
    connectivity: [],
    status: [],
    supportLevel: [],
    sort: "recommended",
  };
}

// Разбирает состояние из query-строки (`window.location.search`) — весь сайдбар (§2) живёт в URL.
export function parseFacetsFromSearch(search: string): FacetState {
  const params = new URLSearchParams(search);
  const state = emptyFacetState();
  const num = (key: string): number | null => {
    const raw = params.get(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const list = (key: string): string[] => (params.get(key) ? params.get(key)!.split(",").filter(Boolean) : []);
  state.q = params.get("q") ?? "";
  state.brands = list("brand");
  state.currency = params.get("cur") === "usd" ? "usd" : "rub";
  state.priceMin = num("price_min");
  state.priceMax = num("price_max");
  state.fitX = num("fit_x");
  state.fitY = num("fit_y");
  state.fitZ = num("fit_z");
  const kind = params.get("kind");
  state.kind = kind === "fdm" || kind === "resin" ? kind : null;
  state.kinematics = list("kin").filter((v): v is KinematicsKey => (KINEMATICS_KEYS as readonly string[]).includes(v));
  state.capabilities = list("cap").filter((v): v is CapabilityKey => (CAPABILITY_KEYS as readonly string[]).includes(v));
  state.hotendMinC = num("hotend_min");
  state.bedMinC = num("bed_min");
  state.flowMin = num("flow_min");
  state.speedMin = num("speed_min");
  state.swappableNozzle = params.get("swap") === "1";
  state.materials = list("mat");
  state.connectivity = list("conn").filter((v): v is ConnectivityKey => (CONNECTIVITY_KEYS as readonly string[]).includes(v));
  state.status = list("status").filter((v): v is PrinterStatusKey => (PRINTER_STATUS_KEYS as readonly string[]).includes(v));
  state.supportLevel = list("support").filter((v): v is SupportLevelKey => (SUPPORT_LEVEL_KEYS as readonly string[]).includes(v));
  const sort = params.get("sort");
  state.sort =
    sort === "new" || sort === "cheaper" || sort === "pricier" || sort === "build_volume" || sort === "relevant" ? sort : "recommended";
  return state;
}

export function facetsToSearch(state: FacetState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.brands.length) params.set("brand", state.brands.join(","));
  if (state.currency !== "rub") params.set("cur", state.currency);
  if (state.priceMin != null) params.set("price_min", String(state.priceMin));
  if (state.priceMax != null) params.set("price_max", String(state.priceMax));
  if (state.fitX != null) params.set("fit_x", String(state.fitX));
  if (state.fitY != null) params.set("fit_y", String(state.fitY));
  if (state.fitZ != null) params.set("fit_z", String(state.fitZ));
  if (state.kind) params.set("kind", state.kind);
  if (state.kinematics.length) params.set("kin", state.kinematics.join(","));
  if (state.capabilities.length) params.set("cap", state.capabilities.join(","));
  if (state.hotendMinC != null) params.set("hotend_min", String(state.hotendMinC));
  if (state.bedMinC != null) params.set("bed_min", String(state.bedMinC));
  if (state.flowMin != null) params.set("flow_min", String(state.flowMin));
  if (state.speedMin != null) params.set("speed_min", String(state.speedMin));
  if (state.swappableNozzle) params.set("swap", "1");
  if (state.materials.length) params.set("mat", state.materials.join(","));
  if (state.connectivity.length) params.set("conn", state.connectivity.join(","));
  if (state.status.length) params.set("status", state.status.join(","));
  if (state.supportLevel.length) params.set("support", state.supportLevel.join(","));
  if (state.sort !== "recommended") params.set("sort", state.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

function num(obj: unknown, path: string): number | null {
  const v = get(obj, path);
  return typeof v === "number" ? v : null;
}

function bool(obj: unknown, path: string): boolean | null {
  const v = get(obj, path);
  return typeof v === "boolean" ? v : null;
}

export function hasCapability(printer: PrinterRecord, key: CapabilityKey): boolean {
  switch (key) {
    case "ams":
      return bool(printer.multimaterial, "supported") === true;
    case "laser":
      return printer.toolhead_extras.some((extra) => extra.kind === "laser" || extra.kind === "cnc-spindle");
    case "enclosed":
      return printer.enclosed === true;
    case "auto_leveling": {
      const v = get(printer.bed, "auto_leveling");
      return typeof v === "string" && v.length > 0 && v !== "none";
    }
    case "hardened":
      return bool(printer.hotend, "hardened") === true;
    case "moonraker":
      return bool(printer.connectivity, "moonraker") === true;
    case "lan_mode":
      return bool(printer.connectivity, "lan_mode") === true;
    default:
      return false;
  }
}

export function printerKind(printer: PrinterRecord): PrinterKind | null {
  if (!printer.type) return null;
  return printer.type === "fdm" ? "fdm" : printer.type.startsWith("resin") ? "resin" : null;
}

export function printerPrice(printer: PrinterRecord, currency: Currency): number | null {
  return currency === "rub" ? num(printer.price, "ru_rub") : num(printer.price, "msrp_usd");
}

export function isStalePrice(printer: PrinterRecord, todayMs: number): boolean {
  const updated = get(printer.price, "ru_updated_at");
  if (typeof updated !== "string") return false;
  const ts = new Date(updated).getTime();
  if (Number.isNaN(ts)) return false;
  return todayMs - ts > 90 * 24 * 60 * 60 * 1000;
}

function matchesSearch(printer: PrinterRecord, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  const haystacks = [printer.brand, printer.model, printer.slug, ...printer.aliases];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

function matchesBuildVolume(printer: PrinterRecord, state: FacetState): boolean {
  if (state.fitX == null && state.fitY == null && state.fitZ == null) return true;
  const x = num(printer.build_volume, "x");
  const y = num(printer.build_volume, "y");
  const z = num(printer.build_volume, "z");
  if (x == null || y == null || z == null) return false;
  if (state.fitX != null && x < state.fitX) return false;
  if (state.fitY != null && y < state.fitY) return false;
  if (state.fitZ != null && z < state.fitZ) return false;
  return true;
}

// Каждая семья фильтров — отдельный предикат, чтобы applyFacets могла исключить ровно одну
// семью (гашение нулевых опций §2.8 и подсчёт "своей" семьи для GapRow §2.9).
export type FamilyKey =
  | "q"
  | "brands"
  | "price"
  | "buildVolume"
  | "kind"
  | "kinematics"
  | "capabilities"
  | "hotendMinC"
  | "bedMinC"
  | "flowMin"
  | "speedMin"
  | "swappableNozzle"
  | "materials"
  | "connectivity"
  | "status"
  | "supportLevel";

const FAMILY_PREDICATES: Record<FamilyKey, (printer: PrinterRecord, state: FacetState) => boolean> = {
  q: (printer, state) => matchesSearch(printer, state.q),
  brands: (printer, state) => state.brands.length === 0 || state.brands.includes(printer.brand),
  price: (printer, state) => {
    if (state.priceMin == null && state.priceMax == null) return true;
    const price = printerPrice(printer, state.currency);
    if (price == null) return true; // цена неизвестна — фасет цены её не режет молча
    if (state.priceMin != null && price < state.priceMin) return false;
    if (state.priceMax != null && price > state.priceMax) return false;
    return true;
  },
  buildVolume: matchesBuildVolume,
  kind: (printer, state) => state.kind == null || printerKind(printer) === state.kind,
  kinematics: (printer, state) => state.kinematics.length === 0 || (printer.kinematics != null && state.kinematics.includes(printer.kinematics as KinematicsKey)),
  capabilities: (printer, state) => state.capabilities.every((key) => hasCapability(printer, key)),
  hotendMinC: (printer, state) => {
    if (state.hotendMinC == null) return true;
    const v = num(printer.hotend, "max_temp_c");
    return v != null && v >= state.hotendMinC;
  },
  bedMinC: (printer, state) => {
    if (state.bedMinC == null) return true;
    const v = num(printer.bed, "max_temp_c");
    return v != null && v >= state.bedMinC;
  },
  flowMin: (printer, state) => {
    if (state.flowMin == null) return true;
    const v = num(printer.hotend, "max_flow_mm3s");
    return v != null && v >= state.flowMin;
  },
  speedMin: (printer, state) => {
    if (state.speedMin == null) return true;
    const v = num(printer.speed, "max_speed_mms");
    return v != null && v >= state.speedMin;
  },
  swappableNozzle: (printer, state) => !state.swappableNozzle || bool(printer.hotend, "nozzle_swappable") === true,
  materials: (printer, state) => state.materials.every((material) => printer.materials_supported.includes(material)),
  connectivity: (printer, state) => state.connectivity.length === 0 || state.connectivity.some((key) => bool(printer.connectivity, key) === true),
  status: (printer, state) => state.status.length === 0 || state.status.includes(printer.status as PrinterStatusKey),
  supportLevel: (printer, state) => state.supportLevel.length === 0 || state.supportLevel.includes((printer.support_level ?? "list") as SupportLevelKey),
};

const ALL_FAMILIES = Object.keys(FAMILY_PREDICATES) as FamilyKey[];

export function applyFacets(printers: PrinterRecord[], state: FacetState, exclude: FamilyKey[] = []): PrinterRecord[] {
  const active = ALL_FAMILIES.filter((f) => !exclude.includes(f));
  return printers.filter((printer) => active.every((family) => FAMILY_PREDICATES[family](printer, state)));
}

export function sortPrinters(printers: PrinterRecord[], state: FacetState): PrinterRecord[] {
  const sort: SortKey = state.q.trim() && state.sort === "recommended" ? "relevant" : state.sort;
  const sorted = [...printers];
  switch (sort) {
    case "new":
      sorted.sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""));
      break;
    case "cheaper":
      sorted.sort((a, b) => rankPrice(printerPrice(a, state.currency)) - rankPrice(printerPrice(b, state.currency)));
      break;
    case "pricier":
      sorted.sort((a, b) => rankPrice(printerPrice(b, state.currency), true) - rankPrice(printerPrice(a, state.currency), true));
      break;
    case "build_volume":
      sorted.sort((a, b) => buildVolumeSize(b) - buildVolumeSize(a));
      break;
    case "relevant":
    case "recommended":
    default:
      sorted.sort((a, b) => Number(b._meta.verified) - Number(a._meta.verified));
      break;
  }
  return sorted;
}

function rankPrice(price: number | null, desc = false): number {
  if (price != null) return price;
  return desc ? -Infinity : Infinity;
}

function buildVolumeSize(printer: PrinterRecord): number {
  const x = num(printer.build_volume, "x") ?? 0;
  const y = num(printer.build_volume, "y") ?? 0;
  const z = num(printer.build_volume, "z") ?? 0;
  return x * y * z;
}

// Опция гаснет (§2.8), если её включение поверх ТЕКУЩЕЙ комбинации остальных фильтров даёт 0.
// baseline — результат по ВСЕМ фильтрам, кроме своей семьи (family исключена из active);
// затем прогоняем именно предикат этой семьи с кандидатом (withOption), не трогая остальные.
export function wouldBeEmpty(printers: PrinterRecord[], state: FacetState, family: FamilyKey, withOption: FacetState): boolean {
  const baseline = applyFacets(printers, state, [family]);
  return baseline.filter((printer) => FAMILY_PREDICATES[family](printer, withOption)).length === 0;
}

// `GapRow` (§2.9): среди семей, у которых сегодня есть значение (фасет активен) и связанное
// схема-поле, — сколько принтеров исключено ИМЕННО из-за null в этом поле (не из-за реального
// несовпадающего значения). Берём семью с наибольшим числом (§2.9 п.4).
const FAMILY_GAP_FIELD: Partial<Record<FamilyKey, { field: string; isMissing: (printer: PrinterRecord) => boolean }>> = {
  kind: { field: "тип принтера", isMissing: (p) => p.type == null },
  kinematics: { field: "кинематика", isMissing: (p) => p.kinematics == null },
  buildVolume: { field: "объём печати", isMissing: (p) => num(p.build_volume, "x") == null || num(p.build_volume, "y") == null || num(p.build_volume, "z") == null },
  hotendMinC: { field: "макс. температура хотэнда", isMissing: (p) => num(p.hotend, "max_temp_c") == null },
  bedMinC: { field: "макс. температура стола", isMissing: (p) => num(p.bed, "max_temp_c") == null },
  flowMin: { field: "поток хотэнда", isMissing: (p) => num(p.hotend, "max_flow_mm3s") == null },
  speedMin: { field: "макс. скорость", isMissing: (p) => num(p.speed, "max_speed_mms") == null },
};

// Возможности (§2.6) — не единая семья с одним схема-полем, а набор чипов, каждый со своим
// null-полем (см. hasCapability). Гэп считается по КОНКРЕТНОМУ активному чипу, не по всей группе.
const CAPABILITY_GAP_FIELD: Record<CapabilityKey, { field: string; isMissing: (printer: PrinterRecord) => boolean }> = {
  ams: { field: "поддержка AMS", isMissing: (p) => bool(p.multimaterial, "supported") == null },
  laser: { field: "лазер/ЧПУ-голова", isMissing: (p) => p._meta.gaps.includes("toolhead_extras") },
  enclosed: { field: "закрытая камера", isMissing: (p) => p.enclosed == null },
  auto_leveling: { field: "автокалибровка стола", isMissing: (p) => get(p.bed, "auto_leveling") == null },
  hardened: { field: "закалённый хотэнд", isMissing: (p) => bool(p.hotend, "hardened") == null },
  moonraker: { field: "Moonraker", isMissing: (p) => bool(p.connectivity, "moonraker") == null },
  lan_mode: { field: "LAN-режим", isMissing: (p) => bool(p.connectivity, "lan_mode") == null },
};

export interface BrandCount {
  brand: string;
  count: number;
  zero: boolean;
}

// Числа рядом с брендом (§2.2) — считаются по выборке, где применены ВСЕ фильтры, кроме самого
// бренда (иначе выбор бренда обнулял бы счётчики остальных брендов до нуля).
export function brandCounts(all: PrinterRecord[], state: FacetState): BrandCount[] {
  const baseline = applyFacets(all, state, ["brands"]);
  const counts = new Map<string, number>();
  for (const printer of baseline) counts.set(printer.brand, (counts.get(printer.brand) ?? 0) + 1);
  const brands = Array.from(new Set(all.map((printer) => printer.brand)));
  return brands
    .map((brand) => {
      const count = counts.get(brand) ?? 0;
      return { brand, count, zero: count === 0 };
    })
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand));
}

export function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export interface GapInfo {
  field: string;
  count: number;
  // Семья, которую надо исключить (или сузить для capabilities), чтобы раскрыть хвост §2.9 —
  // считается вместе с гэпом, а не восстанавливается из текста field на стороне экрана.
  family: FamilyKey;
  capabilityKey?: CapabilityKey;
}

function isFamilyActive(state: FacetState, family: FamilyKey): boolean {
  switch (family) {
    case "kind":
      return state.kind != null;
    case "kinematics":
      return state.kinematics.length > 0;
    case "capabilities":
      return state.capabilities.length > 0;
    case "buildVolume":
      return state.fitX != null || state.fitY != null || state.fitZ != null;
    case "hotendMinC":
      return state.hotendMinC != null;
    case "bedMinC":
      return state.bedMinC != null;
    case "flowMin":
      return state.flowMin != null;
    case "speedMin":
      return state.speedMin != null;
    default:
      return false;
  }
}

export function computeGap(allPrinters: PrinterRecord[], state: FacetState): GapInfo | null {
  const withAll = new Set(applyFacets(allPrinters, state).map((p) => p.id));
  let best: GapInfo | null = null;
  for (const family of Object.keys(FAMILY_GAP_FIELD) as FamilyKey[]) {
    if (!isFamilyActive(state, family)) continue;
    const meta = FAMILY_GAP_FIELD[family]!;
    const withoutThis = applyFacets(allPrinters, state, [family]);
    const removedByThis = withoutThis.filter((p) => !withAll.has(p.id));
    const missingCount = removedByThis.filter(meta.isMissing).length;
    if (missingCount > 0 && (best == null || missingCount > best.count)) {
      best = { field: meta.field, count: missingCount, family };
    }
  }
  if (state.capabilities.length > 0) {
    const otherFamiliesPass = (printer: PrinterRecord) =>
      (Object.keys(FAMILY_PREDICATES) as FamilyKey[])
        .filter((f) => f !== "capabilities")
        .every((f) => FAMILY_PREDICATES[f](printer, state));
    for (const key of state.capabilities) {
      const meta = CAPABILITY_GAP_FIELD[key];
      const withoutKey = allPrinters.filter(
        (printer) => otherFamiliesPass(printer) && state.capabilities.filter((k) => k !== key).every((k) => hasCapability(printer, k)),
      );
      const removedByKey = withoutKey.filter((p) => !withAll.has(p.id));
      const missingCount = removedByKey.filter(meta.isMissing).length;
      if (missingCount > 0 && (best == null || missingCount > best.count)) {
        best = { field: meta.field, count: missingCount, family: "capabilities", capabilityKey: key };
      }
    }
  }
  return best;
}
