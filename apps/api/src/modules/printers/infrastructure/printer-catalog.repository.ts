import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import {
  CatalogCursorError,
  decodePrinterCatalogCursor,
  encodePrinterCatalogCursor,
  fingerprintPrinterCatalogQuery,
  InvalidPrinterCatalogQueryError,
  normalizePrinterCatalogQuery,
} from "../../catalog/public/index.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { PrinterCatalogDetailResponse, PrinterCatalogListItem, PrinterCatalogListResponse, PrinterCatalogReadPort } from "../public/index.ts";
import { serializeCatalogCapabilities, serializePrinter, type PrinterRow } from "./serialize.ts";

const BOOLEAN_FACETS = {
  ams: "multimaterial_supported",
  laser: "has_laser",
  cnc: "has_cnc",
  enclosed: "enclosed",
  hardened: "hotend_hardened",
  moonraker: "moonraker",
  lan_mode: "lan_mode",
} as const;

type PrinterSort = "recommended" | "relevant" | "new" | "price_asc" | "price_desc" | "build_volume";
type CursorValue = string | number | boolean | null;

interface CursorRow extends PrinterRow {
  readonly cursor_released_at: string;
  readonly cursor_updated_at: string;
  readonly cursor_price_is_null: boolean;
  readonly cursor_price: string;
  readonly cursor_volume_is_null: boolean;
  readonly cursor_volume: string;
}

interface CursorKey {
  readonly expression: string;
  readonly cast: string;
  readonly direction: "asc" | "desc";
  readonly read: (row: CursorRow) => CursorValue;
  readonly validate: (value: unknown) => boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year!, month! - 1, day);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

function isNumeric(value: unknown): value is string {
  return typeof value === "string" && NUMERIC_RE.test(value);
}

function cursorKeys(sort: PrinterSort, currency: string): readonly CursorKey[] {
  const dateKey = (expression: string, direction: CursorKey["direction"], read: CursorKey["read"]): CursorKey => ({ expression, cast: "date", direction, read, validate: isDate });
  const timestampKey = (expression: string, direction: CursorKey["direction"], read: CursorKey["read"]): CursorKey => ({
    expression,
    cast: "timestamptz",
    direction,
    read,
    validate: isTimestamp,
  });
  const uuidKey = (direction: CursorKey["direction"]): CursorKey => ({
    expression: "id",
    cast: "uuid",
    direction,
    read: (row) => row.id,
    validate: (value) => typeof value === "string" && UUID_RE.test(value),
  });
  const booleanKey = (expression: string, direction: CursorKey["direction"], read: CursorKey["read"]): CursorKey => ({
    expression,
    cast: "boolean",
    direction,
    read,
    validate: (value) => typeof value === "boolean",
  });
  const numericKey = (expression: string, direction: CursorKey["direction"], read: CursorKey["read"]): CursorKey => ({
    expression,
    cast: "numeric",
    direction,
    read,
    validate: isNumeric,
  });
  switch (sort) {
    case "new":
      return [
        dateKey("coalesce(released_at, '0001-01-01'::date)", "desc", (row) => row.cursor_released_at),
        timestampKey("updated_at", "desc", (row) => row.cursor_updated_at),
        uuidKey("desc"),
      ];
    case "price_asc":
      return [
        numericKey(`case when ${currency} is null then 1 else 0 end`, "asc", (row) => (row.cursor_price_is_null ? "1" : "0")),
        numericKey(`coalesce(${currency}, 0)`, "asc", (row) => row.cursor_price),
        uuidKey("asc"),
      ];
    case "price_desc":
      return [
        numericKey(`case when ${currency} is null then 1 else 0 end`, "asc", (row) => (row.cursor_price_is_null ? "1" : "0")),
        numericKey(`coalesce(${currency}, 0)`, "desc", (row) => row.cursor_price),
        uuidKey("desc"),
      ];
    case "build_volume":
      return [
        numericKey("case when build_volume_x is null or build_volume_y is null or build_volume_z is null then 1 else 0 end", "asc", (row) =>
          row.cursor_volume_is_null ? "1" : "0",
        ),
        numericKey("coalesce(build_volume_x * build_volume_y * build_volume_z, 0)", "desc", (row) => row.cursor_volume),
        uuidKey("desc"),
      ];
    default:
      return [
        booleanKey("verified", "desc", (row) => row.verified),
        booleanKey("coalesce(confidence = 'high', false)", "desc", (row) => row.confidence === "high"),
        timestampKey("updated_at", "desc", (row) => row.cursor_updated_at),
        uuidKey("desc"),
      ];
  }
}

function catalogItem(row: PrinterRow): PrinterCatalogListItem {
  return {
    id: row.id,
    slug: row.slug,
    brand: row.brand,
    model: row.model,
    status: row.status,
    verified: row.verified,
    image_url: (row.media as { hero?: string | null } | null)?.hero ?? null,
    price: {
      rub: typeof row.price_ru_rub === "string" ? Number(row.price_ru_rub) : row.price_ru_rub,
      usd: typeof row.price_msrp_usd === "string" ? Number(row.price_msrp_usd) : row.price_msrp_usd,
      rub_updated_at: row.price_ru_updated_at,
    },
    build_volume_mm: {
      x: typeof row.build_volume_x === "string" ? Number(row.build_volume_x) : row.build_volume_x,
      y: typeof row.build_volume_y === "string" ? Number(row.build_volume_y) : row.build_volume_y,
      z: typeof row.build_volume_z === "string" ? Number(row.build_volume_z) : row.build_volume_z,
    },
    kinematics: row.kinematics,
    capabilities: serializeCatalogCapabilities(row),
  };
}

@Injectable()
export class PrinterCatalogRepository implements PrinterCatalogReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(input: Readonly<Record<string, unknown>>): Promise<{ readonly ok: true; readonly body: PrinterCatalogListResponse } | { readonly ok: false }> {
    let query: ReturnType<typeof normalizePrinterCatalogQuery>;
    try {
      query = normalizePrinterCatalogQuery({ ...input });
    } catch (error) {
      if (error instanceof InvalidPrinterCatalogQueryError) return { ok: false };
      throw error;
    }
    const fingerprint = fingerprintPrinterCatalogQuery(query);
    const conditions: string[] = ["cardinality(sources) > 0"];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    const pushList = (column: string, values: readonly string[]) => {
      if (values.length > 0) push(`${column} = any(?::text[])`, values);
    };
    pushList("status", query.status);
    pushList("lower(brand)", query.brand);
    pushList("kinematics", query.kinematics);
    pushList("type", query.type);
    pushList("support_level", query.support_level);
    if (query.q !== null) {
      params.push(`%${query.q}%`);
      conditions.push(`(brand ilike $${params.length} or model ilike $${params.length} or exists (select 1 from unnest(aliases) a where a ilike $${params.length}))`);
    }
    const currency = query.currency === "usd" ? "price_msrp_usd" : "price_ru_rub";
    if (query.price_min !== null) push(`${currency} >= ?`, query.price_min);
    if (query.price_max !== null) push(`${currency} <= ?`, query.price_max);
    if (query.fits_x !== null) push("build_volume_x >= ?", query.fits_x);
    if (query.fits_y !== null) push("build_volume_y >= ?", query.fits_y);
    if (query.fits_z !== null) push("build_volume_z >= ?", query.fits_z);
    if (query.hotend_min !== null) push("hotend_max_temp_c >= ?", query.hotend_min);
    if (query.bed_min !== null) push("bed_max_temp_c >= ?", query.bed_min);
    if (query.flow_min !== null) push("hotend_max_flow_mm3s >= ?", query.flow_min);
    if (query.speed_min !== null) push("coalesce((specs->'speed'->>'max_mm_s')::numeric, 0) >= ?", query.speed_min);
    if (query.swappable_nozzle === true) conditions.push("nozzle_swappable = true");
    const activeBooleanFacets: Array<{ readonly key: keyof typeof BOOLEAN_FACETS; readonly column: string }> = [];
    for (const [key, column] of Object.entries(BOOLEAN_FACETS) as Array<[keyof typeof BOOLEAN_FACETS, string]>)
      if (query.capabilities.includes(key)) {
        conditions.push(`${column} = true`);
        activeBooleanFacets.push({ key, column });
      }
    if (query.capabilities.includes("auto_leveling")) conditions.push("bed_auto_leveling is not null and bed_auto_leveling <> 'none'");
    const keys = cursorKeys(query.sort, currency);
    const orderBy = keys.map((key) => `${key.expression} ${key.direction}`).join(", ");
    const filterConditions = [...conditions];
    const filterParams = [...params];
    if (input.cursor !== undefined) {
      let cursorValues: readonly CursorValue[];
      try {
        const decoded = decodePrinterCatalogCursor(input.cursor, { fingerprint });
        cursorValues = decoded.position;
        if (cursorValues.length !== keys.length || !cursorValues.every((value, index) => keys[index]!.validate(value))) throw new CatalogCursorError();
      } catch (error) {
        if (error instanceof CatalogCursorError) return { ok: false };
        throw error;
      }
      const cursorStart = params.length + 1;
      const predicates = keys.map((key, index) => {
        const prefix = keys
          .slice(0, index)
          .map((item, prefixIndex) => `${item.expression} = $${cursorStart + prefixIndex}::${item.cast}`)
          .join(" and ");
        return `(${prefix ? `${prefix} and ` : ""}${key.expression} ${key.direction === "desc" ? "<" : ">"} $${cursorStart + index}::${key.cast})`;
      });
      conditions.push(`(${predicates.join(" or ")})`);
      params.push(...cursorValues);
    }
    params.push(query.limit + 1);
    const result = await this.pool.query<CursorRow>(
      `select printers.*,coalesce(released_at,'0001-01-01'::date)::text cursor_released_at,updated_at::text cursor_updated_at,(${currency} is null) cursor_price_is_null,coalesce(${currency},0)::text cursor_price,(build_volume_x is null or build_volume_y is null or build_volume_z is null) cursor_volume_is_null,coalesce(build_volume_x*build_volume_y*build_volume_z,0)::text cursor_volume from printers where ${conditions.join(" and ")} order by ${orderBy} limit $${params.length}`,
      params,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const last = rows.at(-1);
    const nextCursor = hasMore && last !== undefined ? encodePrinterCatalogCursor({ fingerprint, position: keys.map((key) => key.read(last)) }) : null;
    const gapCounts: Record<string, number> = {};
    for (const { key, column } of activeBooleanFacets) {
      const gapConditions = filterConditions.filter((condition) => condition !== `${column} = true`);
      gapConditions.push(`${column} is null`);
      const gap = await this.pool.query<{ count: string }>(`select count(*) count from printers where ${gapConditions.join(" and ")}`, filterParams);
      gapCounts[key] = Number(gap.rows[0]?.count ?? 0);
    }
    return {
      ok: true,
      body: {
        contract_version: "printers.catalog.v1",
        items: rows.map(catalogItem),
        printers: rows.map((row) => serializePrinter(row)),
        has_more: hasMore,
        next_cursor: nextCursor,
        gap_counts: gapCounts,
      },
    };
  }

  async detail(slug: string): Promise<PrinterCatalogDetailResponse | null> {
    const row = (await this.pool.query<PrinterRow>(`select * from printers where slug=$1`, [slug])).rows[0];
    return row === undefined || row.sources.length === 0 ? null : { printer: serializePrinter(row) };
  }
}
