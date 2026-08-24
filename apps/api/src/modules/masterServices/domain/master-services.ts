export const MASTER_SERVICE_TECHNOLOGIES = ["fdm", "sla", "sls", "laser", "cnc"] as const;
export type MasterServiceTechnology = (typeof MASTER_SERVICE_TECHNOLOGIES)[number];
export const MASTER_SERVICE_PRICE_MODES = ["fixed", "range", "per_gram", "per_cm3", "per_hour"] as const;
export type MasterServicePriceMode = (typeof MASTER_SERVICE_PRICE_MODES)[number];
export const MASTER_SERVICE_DELIVERY_METHODS = ["pickup", "courier", "post", "any"] as const;
export type MasterServiceDeliveryMethod = (typeof MASTER_SERVICE_DELIVERY_METHODS)[number];

export const TITLE_MAX_LENGTH = 200;
export const MAX_MATERIAL_IDS = 20;
export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 100;

export interface MasterServiceRow {
  readonly id: string;
  readonly master_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly technology: string;
  readonly machine_id: string | null;
  readonly price_mode: string;
  readonly price_min_minor: string | null;
  readonly price_max_minor: string | null;
  readonly currency: string;
  readonly min_order_qty: number;
  readonly min_order_amount_minor: string | null;
  readonly lead_time_days_min: number | null;
  readonly lead_time_days_max: number | null;
  readonly delivery_zone: string | null;
  readonly delivery_method: string;
  readonly deleted_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface MasterServiceWrite {
  readonly title?: string;
  readonly description?: string | null;
  readonly technology?: MasterServiceTechnology;
  readonly machineId?: string | null;
  readonly priceMode?: MasterServicePriceMode;
  readonly priceMinMinor?: number;
  readonly priceMaxMinor?: number;
  readonly currency?: string;
  readonly minOrderQty?: number;
  readonly minOrderAmountMinor?: number;
  readonly leadTimeDaysMin?: number;
  readonly leadTimeDaysMax?: number;
  readonly deliveryZone?: string | null;
  readonly deliveryMethod?: MasterServiceDeliveryMethod;
  readonly materialIds?: readonly string[];
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isTechnology(value: unknown): value is MasterServiceTechnology {
  return typeof value === "string" && (MASTER_SERVICE_TECHNOLOGIES as readonly string[]).includes(value);
}
export function isPriceMode(value: unknown): value is MasterServicePriceMode {
  return typeof value === "string" && (MASTER_SERVICE_PRICE_MODES as readonly string[]).includes(value);
}
export function isDeliveryMethod(value: unknown): value is MasterServiceDeliveryMethod {
  return typeof value === "string" && (MASTER_SERVICE_DELIVERY_METHODS as readonly string[]).includes(value);
}
export function optionalNonNegativeInt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
export function rangeError(
  priceMin: number | null | undefined,
  priceMax: number | null | undefined,
  leadMin: number | null | undefined,
  leadMax: number | null | undefined,
): boolean {
  return (priceMin != null && priceMax != null && priceMax < priceMin) || (leadMin != null && leadMax != null && leadMax < leadMin);
}
export function parseLimit(raw: unknown): number {
  const parsed = Number(raw);
  return !Number.isFinite(parsed) || parsed <= 0 ? DEFAULT_LIMIT : Math.min(Math.floor(parsed), MAX_LIMIT);
}
export function parseOffset(raw: unknown): number {
  const parsed = Number(raw);
  return !Number.isFinite(parsed) || parsed <= 0 ? 0 : Math.floor(parsed);
}
export function toServiceJson(row: MasterServiceRow, materialIds: readonly string[]) {
  return {
    id: row.id,
    master_id: row.master_id,
    title: row.title,
    description: row.description,
    technology: row.technology,
    machine_id: row.machine_id,
    price_mode: row.price_mode,
    price_min_minor: row.price_min_minor === null ? null : Number(row.price_min_minor),
    price_max_minor: row.price_max_minor === null ? null : Number(row.price_max_minor),
    currency: row.currency,
    min_order_qty: row.min_order_qty,
    min_order_amount_minor: row.min_order_amount_minor === null ? null : Number(row.min_order_amount_minor),
    lead_time_days_min: row.lead_time_days_min,
    lead_time_days_max: row.lead_time_days_max,
    delivery_zone: row.delivery_zone,
    delivery_method: row.delivery_method,
    material_ids: materialIds,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
