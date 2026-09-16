import type { CatalogJsonObject, CatalogJsonValue } from "../public/index.ts";

export const MATERIAL_ADMIN_KINDS = ["filament", "resin", "plywood", "aluminum"] as const;
export const MATERIAL_ADMIN_STATUSES = ["draft", "published", "archived"] as const;
export type MaterialAdminKind = (typeof MATERIAL_ADMIN_KINDS)[number];
export type MaterialAdminStatus = (typeof MATERIAL_ADMIN_STATUSES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export interface MaterialAdminCreateInput {
  readonly kind: MaterialAdminKind;
  readonly slug: string;
  readonly name: string;
  readonly vendorId: string;
  readonly materialTypeId: string;
  readonly specs: CatalogJsonObject;
}

export interface MaterialAdminUpdateInput {
  readonly version: number;
  readonly name?: string;
  readonly kind?: MaterialAdminKind;
  readonly vendorId?: string;
  readonly materialTypeId?: string;
  readonly specs?: CatalogJsonObject;
}

function isJsonValue(value: unknown): value is CatalogJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

export function parseMaterialCreate(value: unknown): MaterialAdminCreateInput | null {
  if (!isObject(value)) return null;
  const kind = MATERIAL_ADMIN_KINDS.find((candidate) => candidate === value.kind);
  const slug = text(value.slug, 160);
  const name = text(value.name, 200);
  const vendorId = text(value.vendor_id, 36);
  const materialTypeId = text(value.material_type_id, 36);
  if (kind === undefined || slug === null || !SLUG_RE.test(slug) || name === null || vendorId === null || !UUID_RE.test(vendorId)
    || materialTypeId === null || !UUID_RE.test(materialTypeId) || !isObject(value.specs) || !isJsonValue(value.specs)) return null;
  return { kind, slug, name, vendorId, materialTypeId, specs: value.specs };
}

export function parseMaterialUpdate(value: unknown): MaterialAdminUpdateInput | null {
  if (!isObject(value) || !Number.isInteger(value.version) || typeof value.version !== "number" || value.version < 1) return null;
  const name = value.name === undefined ? undefined : text(value.name, 200);
  const kind = value.kind === undefined ? undefined : MATERIAL_ADMIN_KINDS.find((candidate) => candidate === value.kind);
  const vendorId = value.vendor_id === undefined ? undefined : text(value.vendor_id, 36);
  const materialTypeId = value.material_type_id === undefined ? undefined : text(value.material_type_id, 36);
  if (value.status !== undefined) return null;
  if (name === null || (value.kind !== undefined && kind === undefined) || vendorId === null || (vendorId !== undefined && !UUID_RE.test(vendorId))
    || materialTypeId === null || (materialTypeId !== undefined && !UUID_RE.test(materialTypeId))
    || (value.specs !== undefined && (!isObject(value.specs) || !isJsonValue(value.specs)))) return null;
  return {
    version: value.version,
    ...(name === undefined ? {} : { name }),
    ...(kind === undefined ? {} : { kind }),
    ...(vendorId === undefined ? {} : { vendorId }),
    ...(materialTypeId === undefined ? {} : { materialTypeId }),
    ...(value.specs === undefined ? {} : { specs: value.specs }),
  };
}
