import { createHash } from "node:crypto";

// Значения дублируют публичный шов packages/contracts/http/printers.ts намеренно: API-тесты
// запускаются до сборки workspace-пакетов, а эти константы нужны только для валидации query.
const PRINTER_CATALOG_PAGE_LIMIT = 24;
const PRINTER_CATALOG_SORTS = ["recommended", "relevant", "new", "price_asc", "price_desc", "build_volume"] as const;
const PRINTER_CATALOG_CAPABILITIES = ["ams", "laser", "cnc", "enclosed", "auto_leveling", "hardened", "moonraker", "lan_mode"] as const;
type PrinterCatalogSort = (typeof PRINTER_CATALOG_SORTS)[number];
type PrinterCatalogCapability = (typeof PRINTER_CATALOG_CAPABILITIES)[number];

const STATUSES = ["announced", "shipping", "eol", "rumored"] as const;
const TYPES = ["fdm", "resin-lcd", "resin-dlp", "resin-sla"] as const;
const KINEMATICS = ["cartesian", "corexy", "delta", "scara", "idex", "polar", "belt"] as const;
const CURRENCIES = ["rub", "usd"] as const;
const BOOLEAN_CAPABILITY_KEYS = ["ams", "laser", "cnc", "enclosed", "auto_leveling", "hardened", "moonraker", "lan_mode"] as const;
const LIST_KEYS = ["brand", "type", "kinematics", "status", "capabilities", "materials", "connectivity", "support_level"] as const;

type NumberKey = "price_min" | "price_max" | "fits_x" | "fits_y" | "fits_z" | "hotend_min" | "bed_min" | "flow_min" | "speed_min";
type ListKey = (typeof LIST_KEYS)[number];

export interface PrinterCatalogQuery {
  q: string | null;
  brand: string[];
  type: string[];
  kinematics: string[];
  status: string[];
  capabilities: PrinterCatalogCapability[];
  materials: string[];
  connectivity: string[];
  support_level: string[];
  price_min: number | null;
  price_max: number | null;
  fits_x: number | null;
  fits_y: number | null;
  fits_z: number | null;
  hotend_min: number | null;
  bed_min: number | null;
  flow_min: number | null;
  speed_min: number | null;
  swappable_nozzle: boolean | null;
  currency: (typeof CURRENCIES)[number];
  sort: PrinterCatalogSort;
  limit: number;
}

export class InvalidPrinterCatalogQueryError extends Error {
  readonly code = "invalid_query" as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidPrinterCatalogQueryError";
  }
}

function invalid(field: string, message: string): never {
  throw new InvalidPrinterCatalogQueryError(field, message);
}

function asString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") invalid(field, "ожидается строка");
  return value;
}

function normalizeList(value: unknown, field: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  const raw = Array.isArray(value) ? value : [value];
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") invalid(field, "ожидается строка или список строк");
    for (const part of item.split(",")) {
      const normalized = part.trim().normalize("NFKC").toLowerCase();
      if (!normalized) invalid(field, "пустое значение");
      values.push(normalized);
    }
  }
  return [...new Set(values)].sort();
}

function normalizeSearch(value: unknown): string | null {
  const raw = asString(value, "q")?.trim() ?? "";
  if (raw.length > 200) invalid("q", "не более 200 символов");
  return raw ? raw.normalize("NFKC").toLowerCase() : null;
}

function normalizeNumber(value: unknown, field: NumberKey): number | null {
  const raw = asString(value, field)?.trim() ?? "";
  if (!raw) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) invalid(field, "ожидается неотрицательное число");
  const number = Number(raw);
  if (!Number.isFinite(number)) invalid(field, "ожидается конечное число");
  return number;
}

function normalizeBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "1" || value === 1 || value === true) return true;
  if (value === "0" || value === 0 || value === false) return false;
  invalid(field, "ожидается 1 или 0");
}

function validateEnum(value: string[], field: string, allowed: readonly string[]): string[] {
  for (const item of value) {
    if (!allowed.includes(item)) invalid(field, `недопустимое значение: ${item}`);
  }
  return value;
}

function normalizeSort(value: unknown, q: string | null): PrinterCatalogSort {
  const raw = asString(value, "sort")?.trim().toLowerCase() ?? "recommended";
  if (!(PRINTER_CATALOG_SORTS as readonly string[]).includes(raw)) invalid("sort", "недопустимый порядок");
  if (raw === "relevant" && !q) return "recommended";
  return raw as PrinterCatalogSort;
}

function normalizeLimit(value: unknown): number {
  const raw = asString(value, "limit")?.trim() ?? "";
  if (!raw) return PRINTER_CATALOG_PAGE_LIMIT;
  if (!/^\d+$/.test(raw)) invalid("limit", "ожидается целое число");
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid("limit", "ожидается число от 1 до 100");
  return limit;
}

/** Приводит raw query к единственному представлению, которое участвует в cursor fingerprint. */
export function normalizePrinterCatalogQuery(input: Record<string, unknown>): PrinterCatalogQuery {
  const q = normalizeSearch(input.q);
  const query = {
    q,
    brand: normalizeList(input.brand, "brand"),
    type: validateEnum(normalizeList(input.type, "type"), "type", TYPES),
    kinematics: validateEnum(normalizeList(input.kinematics, "kinematics"), "kinematics", KINEMATICS),
    status: validateEnum(normalizeList(input.status, "status"), "status", STATUSES),
    capabilities: [] as PrinterCatalogCapability[],
    materials: normalizeList(input.materials, "materials"),
    connectivity: normalizeList(input.connectivity, "connectivity"),
    support_level: validateEnum(normalizeList(input.support_level, "support_level"), "support_level", ["list", "managed", "custom"]),
    price_min: normalizeNumber(input.price_min, "price_min"),
    price_max: normalizeNumber(input.price_max, "price_max"),
    fits_x: normalizeNumber(input.fits_x, "fits_x"),
    fits_y: normalizeNumber(input.fits_y, "fits_y"),
    fits_z: normalizeNumber(input.fits_z, "fits_z"),
    hotend_min: normalizeNumber(input.hotend_min, "hotend_min"),
    bed_min: normalizeNumber(input.bed_min, "bed_min"),
    flow_min: normalizeNumber(input.flow_min, "flow_min"),
    speed_min: normalizeNumber(input.speed_min, "speed_min"),
    swappable_nozzle: normalizeBoolean(input.swappable_nozzle, "swappable_nozzle"),
    currency: (asString(input.currency, "currency")?.trim().toLowerCase() ?? "rub") as (typeof CURRENCIES)[number],
    sort: normalizeSort(input.sort, q),
    limit: normalizeLimit(input.limit),
  } satisfies Omit<PrinterCatalogQuery, "capabilities"> & { capabilities: PrinterCatalogCapability[] };

  if (!(CURRENCIES as readonly string[]).includes(query.currency)) invalid("currency", "ожидается rub или usd");
  if (query.price_min !== null && query.price_max !== null && query.price_min > query.price_max) {
    invalid("price_min", "не может быть больше price_max");
  }

  const capabilities = new Set<PrinterCatalogCapability>(normalizeList(input.capabilities, "capabilities") as PrinterCatalogCapability[]);
  for (const capability of BOOLEAN_CAPABILITY_KEYS) {
    const enabled = normalizeBoolean(input[capability], capability);
    if (enabled === true) capabilities.add(capability);
  }
  validateEnum([...capabilities], "capabilities", PRINTER_CATALOG_CAPABILITIES);
  query.capabilities = [...capabilities].sort();
  return query;
}

/** SHA-256 только канонического query: исходные параметры и cursor в fingerprint не попадают. */
export function fingerprintPrinterCatalogQuery(query: PrinterCatalogQuery): string {
  const canonical = JSON.stringify({
    q: query.q,
    brand: query.brand,
    type: query.type,
    kinematics: query.kinematics,
    status: query.status,
    capabilities: query.capabilities,
    materials: query.materials,
    connectivity: query.connectivity,
    support_level: query.support_level,
    price_min: query.price_min,
    price_max: query.price_max,
    fits_x: query.fits_x,
    fits_y: query.fits_y,
    fits_z: query.fits_z,
    hotend_min: query.hotend_min,
    bed_min: query.bed_min,
    flow_min: query.flow_min,
    speed_min: query.speed_min,
    swappable_nozzle: query.swappable_nozzle,
    currency: query.currency,
    sort: query.sort,
    limit: query.limit,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function isPrinterCatalogListKey(value: string): value is ListKey {
  return (LIST_KEYS as readonly string[]).includes(value);
}
