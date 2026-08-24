// Строка printers (MF-878) ↔ форма ответа API. Detail DTO не отдаёт `specs` как есть:
// старые jsonb-строки могут быть пустыми или частично неверными. Здесь известные поля schema v1
// приводятся к единственной форме, а facet-колонки остаются fallback для legacy-данных.

import { serializePilotStatus } from "./pilot.ts";
import type { PrinterCatalogPrinter, PrinterJsonObject, PrinterJsonValue } from "../public/index.ts";

export interface PrinterRow {
  id: string;
  slug: string;
  brand: string;
  model: string;
  aliases: string[];
  released_at: string | null;
  status: string;
  kinematics: string | null;
  type: string | null;
  enclosed: boolean | null;
  build_volume_x: number | string | null;
  build_volume_y: number | string | null;
  build_volume_z: number | string | null;
  hotend_max_temp_c: number | string | null;
  hotend_max_flow_mm3s: number | string | null;
  hotend_hardened: boolean | null;
  bed_max_temp_c: number | string | null;
  bed_auto_leveling: string | null;
  multimaterial_supported: boolean;
  has_laser: boolean;
  has_cnc: boolean;
  nozzle_swappable: boolean | null;
  moonraker: boolean | null;
  lan_mode: boolean | null;
  price_msrp_usd: number | string | null;
  price_ru_rub: number | string | null;
  price_ru_updated_at: string | null;
  support_level: string | null;
  firmware_ready: boolean | null;
  firmware_public: boolean | null;
  connector_type: string | null;
  firmware_repo: string | null;
  pilot_status: unknown;
  specs: Record<string, unknown>;
  media: Record<string, unknown>;
  sources: string[];
  field_provenance: Record<string, unknown>;
  confidence: string | null;
  filled_by: string | null;
  reviewed_by: string | null;
  gaps: string[];
  verified: boolean;
  schema_version: string;
  created_at: string;
  updated_at: string;
}

const TOOLHEAD_KINDS = new Set(["laser", "cnc-spindle", "cutter", "pen", "foodpaste", "other"]);

function isUnknownRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): { readonly [key: string]: unknown } {
  return isUnknownRecord(value) ? value : {};
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// node-pg parses `date`/`timestamptz` columns into native Date objects, not strings — plain
// stringOrNull silently dropped every real DB date/timestamp to null (MF-1851), which is why
// `_meta.updated_at` (a `date` round-tripped by research clients as `base_updated_at` for
// conflict detection) and `released_at`/`price.ru_updated_at` always read back null once a row
// came from Postgres instead of a test fixture. `date` columns are parsed at LOCAL midnight
// (pg's own convention) — getFullYear/Month/Date (not the UTC getters) recover the stored day.
function dateOnlyOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return stringOrNull(value);
}

function timestampOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return stringOrNull(value);
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** JSONB переопределяет column facet только валидным значением; иначе старый row остаётся читаемым. */
function valueOrLegacy<T>(section: Record<string, unknown>, key: string, legacy: T, normalize: (value: unknown) => T | null): T | null {
  if (!hasOwn(section, key)) return normalize(legacy);
  return normalize(section[key]) ?? normalize(legacy);
}

function numericValueOrLegacy(section: { readonly [key: string]: unknown }, key: string, legacy: unknown): number | null {
  if (!hasOwn(section, key)) return numberOrNull(legacy);
  return numberOrNull(section[key]) ?? numberOrNull(legacy);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values = new Set<string>();
  for (const item of value) {
    const normalized = stringOrNull(item);
    if (normalized) values.add(normalized);
  }
  return [...values].sort((left, right) => left.toLocaleLowerCase("en-US").localeCompare(right.toLocaleLowerCase("en-US")) || left.localeCompare(right));
}

/** Только JSON-совместимые значения; ключи сортируются, чтобы fixture/golden JSON был воспроизводим. */
function canonicalJson(value: unknown): PrinterJsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return stringOrNull(value);
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    const result: Record<string, PrinterJsonValue> = {};
    const record = recordOrEmpty(value);
    for (const key of Object.keys(record).sort()) result[key] = canonicalJson(record[key]);
    return result;
  }
  return null;
}

function canonicalJsonObject(value: unknown): PrinterJsonObject {
  const result: { [key: string]: PrinterJsonValue } = {};
  const record = recordOrEmpty(value);
  for (const key of Object.keys(record).sort()) result[key] = canonicalJson(record[key]);
  return result;
}

function optionalNumber(section: Record<string, unknown>, key: string): number | null {
  return hasOwn(section, key) ? numberOrNull(section[key]) : null;
}

function optionalString(section: Record<string, unknown>, key: string): string | null {
  return hasOwn(section, key) ? stringOrNull(section[key]) : null;
}

function optionalBoolean(section: Record<string, unknown>, key: string): boolean | null {
  return hasOwn(section, key) ? booleanOrNull(section[key]) : null;
}

function serializeToolheadExtras(value: unknown): Array<{ kind: string; spec: string | null }> {
  if (!Array.isArray(value)) return [];
  const extras: Array<{ kind: string; spec: string | null }> = [];
  for (const item of value) {
    const extra = recordOrEmpty(item);
    const kind = stringOrNull(extra.kind);
    if (!kind || !TOOLHEAD_KINDS.has(kind)) continue;
    extras.push({ kind, spec: stringOrNull(extra.spec) });
  }
  return extras.sort((left, right) => left.kind.localeCompare(right.kind) || (left.spec ?? "").localeCompare(right.spec ?? ""));
}

/** Единственный словарь capability публичного каталога; строка `none` не является capability. */
export function serializeCatalogCapabilities(row: PrinterRow): string[] {
  const autoLeveling = stringOrNull(row.bed_auto_leveling);
  return [
    row.multimaterial_supported ? "ams" : null,
    row.has_laser ? "laser" : null,
    row.has_cnc ? "cnc" : null,
    row.enclosed === true ? "enclosed" : null,
    autoLeveling && autoLeveling.toLowerCase() !== "none" ? "auto_leveling" : null,
    row.hotend_hardened ? "hardened" : null,
    row.moonraker ? "moonraker" : null,
    row.lan_mode ? "lan_mode" : null,
  ].filter((capability): capability is string => capability !== null);
}

export function serializePrinter(row: PrinterRow, now = new Date()): PrinterCatalogPrinter {
  const specs = recordOrEmpty(row.specs);
  const buildVolume = recordOrEmpty(specs.build_volume);
  const hotend = recordOrEmpty(specs.hotend);
  const bed = recordOrEmpty(specs.bed);
  const speed = recordOrEmpty(specs.speed);
  const multimaterial = recordOrEmpty(specs.multimaterial);
  const connectivity = recordOrEmpty(specs.connectivity);
  const dimensions = recordOrEmpty(specs.dimensions_mm);
  const price = recordOrEmpty(specs.price);
  const media = recordOrEmpty(row.media);

  return {
    id: row.id,
    slug: row.slug,
    brand: stringOrNull(row.brand) ?? "",
    model: stringOrNull(row.model) ?? "",
    aliases: strings(row.aliases),
    released_at: dateOnlyOrNull(row.released_at),
    status: row.status,
    kinematics: stringOrNull(row.kinematics),
    type: stringOrNull(row.type),
    enclosed: booleanOrNull(row.enclosed),
    build_volume: {
      x: numericValueOrLegacy(buildVolume, "x", row.build_volume_x),
      y: numericValueOrLegacy(buildVolume, "y", row.build_volume_y),
      z: numericValueOrLegacy(buildVolume, "z", row.build_volume_z),
      shape: optionalString(buildVolume, "shape"),
      diameter: optionalNumber(buildVolume, "diameter"),
    },
    hotend: {
      max_temp_c: numericValueOrLegacy(hotend, "max_temp_c", row.hotend_max_temp_c),
      max_flow_mm3s: numericValueOrLegacy(hotend, "max_flow_mm3s", row.hotend_max_flow_mm3s),
      nozzle_default_mm: optionalNumber(hotend, "nozzle_default_mm"),
      nozzle_swappable: valueOrLegacy(hotend, "nozzle_swappable", row.nozzle_swappable, booleanOrNull),
      material: optionalString(hotend, "material"),
      hardened: valueOrLegacy(hotend, "hardened", row.hotend_hardened, booleanOrNull),
    },
    bed: {
      max_temp_c: numericValueOrLegacy(bed, "max_temp_c", row.bed_max_temp_c),
      surface: optionalString(bed, "surface"),
      auto_leveling: valueOrLegacy(bed, "auto_leveling", row.bed_auto_leveling, stringOrNull),
    },
    speed: {
      max_speed_mms: optionalNumber(speed, "max_speed_mms"),
      max_accel_mms2: optionalNumber(speed, "max_accel_mms2"),
      input_shaping: optionalBoolean(speed, "input_shaping"),
    },
    multimaterial: {
      supported: valueOrLegacy(multimaterial, "supported", row.multimaterial_supported, booleanOrNull) ?? false,
      system_name: optionalString(multimaterial, "system_name"),
      max_colors: optionalNumber(multimaterial, "max_colors"),
      unique_notes: optionalString(multimaterial, "unique_notes"),
    },
    toolhead_extras: serializeToolheadExtras(specs.toolhead_extras),
    connectivity: {
      wifi: optionalBoolean(connectivity, "wifi"),
      ethernet: optionalBoolean(connectivity, "ethernet"),
      usb: optionalBoolean(connectivity, "usb"),
      camera: optionalBoolean(connectivity, "camera"),
      firmware: optionalString(connectivity, "firmware"),
      moonraker: valueOrLegacy(connectivity, "moonraker", row.moonraker, booleanOrNull),
      lan_mode: valueOrLegacy(connectivity, "lan_mode", row.lan_mode, booleanOrNull),
    },
    materials_supported: strings(specs.materials_supported),
    dimensions_mm: {
      w: optionalNumber(dimensions, "w"),
      d: optionalNumber(dimensions, "d"),
      h: optionalNumber(dimensions, "h"),
      weight_kg: optionalNumber(dimensions, "weight_kg"),
    },
    price: {
      msrp_usd: numericValueOrLegacy(price, "msrp_usd", row.price_msrp_usd),
      ru_rub: numericValueOrLegacy(price, "ru_rub", row.price_ru_rub),
      ru_updated_at: valueOrLegacy(price, "ru_updated_at", row.price_ru_updated_at, dateOnlyOrNull),
    },
    unique_features: strings(specs.unique_features),
    support_level: stringOrNull(row.support_level),
    firmware_ready: booleanOrNull(row.firmware_ready),
    firmware_public: booleanOrNull(row.firmware_public),
    connector_type: stringOrNull(row.connector_type),
    firmware_repo: stringOrNull(row.firmware_repo),
    pilot_status: serializePilotStatus(row.pilot_status, now),
    media: {
      hero: optionalString(media, "hero"),
      gallery: strings(media.gallery),
      official_url: optionalString(media, "official_url"),
    },
    sources: strings(row.sources),
    field_sources: canonicalJsonObject(row.field_provenance),
    _meta: {
      schema_version: stringOrNull(row.schema_version) ?? "1.0",
      filled_by: stringOrNull(row.filled_by),
      reviewed_by: stringOrNull(row.reviewed_by),
      confidence: stringOrNull(row.confidence),
      gaps: strings(row.gaps),
      verified: row.verified === true,
      updated_at: timestampOrNull(row.updated_at),
    },
  };
}

export function serializePrinterSummary(row: PrinterRow) {
  return {
    id: row.id,
    slug: row.slug,
    brand: row.brand,
    model: row.model,
    status: row.status,
    kinematics: row.kinematics,
    type: row.type,
    enclosed: row.enclosed,
    build_volume: { x: numberOrNull(row.build_volume_x), y: numberOrNull(row.build_volume_y), z: numberOrNull(row.build_volume_z) },
    multimaterial_supported: row.multimaterial_supported,
    has_laser: row.has_laser,
    has_cnc: row.has_cnc,
    price: { msrp_usd: numberOrNull(row.price_msrp_usd), ru_rub: numberOrNull(row.price_ru_rub), ru_updated_at: row.price_ru_updated_at },
    media_hero: optionalString(recordOrEmpty(row.media), "hero"),
    verified: row.verified,
    confidence: row.confidence,
    support_level: row.support_level,
    firmware_ready: row.firmware_ready,
    firmware_public: row.firmware_public,
    connector_type: row.connector_type,
    firmware_repo: row.firmware_repo,
  };
}
