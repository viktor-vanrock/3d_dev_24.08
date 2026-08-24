/** Публичный HTTP-шов `apps/api/catalog` → `apps/web/printers`. */
export const PRINTER_CATALOG_CONTRACT_VERSION = "printers.catalog.v1" as const;

/** Размер страницы фиксирован для одной цепочки cursor; API может вернуть меньше на последней. */
export const PRINTER_CATALOG_PAGE_LIMIT = 24;

export const PRINTER_CATALOG_SORTS = ["recommended", "relevant", "new", "price_asc", "price_desc", "build_volume"] as const;
export type PrinterCatalogSort = (typeof PRINTER_CATALOG_SORTS)[number];

/** Нормализованный query, на котором producer строит fingerprint cursor. */
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
  currency: "rub" | "usd";
  sort: PrinterCatalogSort;
  limit: number;
}

export interface PrinterCatalogError {
  error: "invalid_query" | "invalid_cursor";
  request_id: string;
}

export const PRINTER_CATALOG_CAPABILITIES = ["ams", "laser", "cnc", "enclosed", "auto_leveling", "hardened", "moonraker", "lan_mode"] as const;
export type PrinterCatalogCapability = (typeof PRINTER_CATALOG_CAPABILITIES)[number];

export interface PrinterCatalogItem {
  id: string;
  slug: string;
  brand: string;
  model: string;
  status: "announced" | "shipping" | "eol" | "rumored";
  verified: boolean;
  image_url: string | null;
  price: { rub: number | null; usd: number | null; rub_updated_at: string | null };
  build_volume_mm: { x: number | null; y: number | null; z: number | null };
  kinematics: string | null;
  capabilities: PrinterCatalogCapability[];
}

export interface PrinterCatalogPage {
  contract_version: typeof PRINTER_CATALOG_CONTRACT_VERSION;
  items: PrinterCatalogItem[];
  /** Равно `next_cursor !== null`; курсор непрозрачен для web. */
  has_more: boolean;
  next_cursor: string | null;
  /** Число исключённых `null` по активному фасету для честного GapRow. */
  gap_counts: Partial<Record<PrinterCatalogCapability, number>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isItem(value: unknown): value is PrinterCatalogItem {
  if (!isRecord(value)) return false;
  const price = value.price;
  const volume = value.build_volume_mm;
  return typeof value.id === "string"
    && typeof value.slug === "string"
    && typeof value.brand === "string"
    && typeof value.model === "string"
    && ["announced", "shipping", "eol", "rumored"].includes(String(value.status))
    && typeof value.verified === "boolean"
    && (value.image_url === null || typeof value.image_url === "string")
    && isRecord(price)
    && isNumberOrNull(price.rub)
    && isNumberOrNull(price.usd)
    && (price.rub_updated_at === null || typeof price.rub_updated_at === "string")
    && isRecord(volume)
    && isNumberOrNull(volume.x)
    && isNumberOrNull(volume.y)
    && isNumberOrNull(volume.z)
    && (value.kinematics === null || typeof value.kinematics === "string")
    && Array.isArray(value.capabilities)
    && value.capabilities.every((capability) => (PRINTER_CATALOG_CAPABILITIES as readonly string[]).includes(String(capability)));
}

/** Runtime guard для consumer-теста; не выполняет запросы и не декодирует cursor. */
export function isPrinterCatalogPage(value: unknown): value is PrinterCatalogPage {
  if (!isRecord(value)) return false;
  if (value.contract_version !== PRINTER_CATALOG_CONTRACT_VERSION || !Array.isArray(value.items) || !value.items.every(isItem)) return false;
  if (typeof value.has_more !== "boolean" || !(value.next_cursor === null || typeof value.next_cursor === "string")) return false;
  if (value.has_more !== (value.next_cursor !== null) || !isRecord(value.gap_counts)) return false;
  return Object.entries(value.gap_counts).every(([key, count]) => (PRINTER_CATALOG_CAPABILITIES as readonly string[]).includes(key) && typeof count === "number" && Number.isInteger(count) && count >= 0);
}
