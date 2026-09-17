import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { resolveVendorName } from "../../src/modules/catalog/public/operations.ts";
import { readJsonArray } from "./read-snapshot.ts";
import type { ForgeMaterial, SectionReport } from "./types.ts";
import { isObject, jsonObject, stringValue } from "./types.ts";

interface StaticMaterial {
  readonly id: string;
  readonly record: ForgeMaterial;
  readonly displayName: string;
  readonly family: string;
}

function slug(value: string): string {
  const latin = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return latin || `item-${createHash("sha1").update(value).digest("hex").slice(0, 10)}`;
}

export function snapshotMaterialKind(value: unknown): "filament" | null {
  if (value === undefined || value === "filament") return "filament";
  return null;
}

function parseMaterial(value: unknown): ForgeMaterial | null {
  if (!isObject(value) || value.kind !== "material" || value.outcome !== "staged") return null;
  if (snapshotMaterialKind(value.material_kind) === null) return null;
  const brand = stringValue(value.brand);
  const url = stringValue(value.url);
  const fields = jsonObject(value.fields);
  const evidence = jsonObject(value.evidence);
  if (!brand || !url || !fields || !evidence) return null;
  return { brand, lineName: stringValue(value.line_name), family: stringValue(value.family), url, fields, evidence };
}

export async function loadMaterials(sourceDirectory: string): Promise<{ readonly records: readonly StaticMaterial[]; readonly found: number; readonly rejected: number }> {
  const input = await readJsonArray(sourceDirectory, "materials.json");
  const records: StaticMaterial[] = [];
  let rejected = 0;
  for (const [index, value] of input.entries()) {
    const record = parseMaterial(value);
    if (!record) { rejected += 1; continue; }
    const displayName = record.lineName ?? `${record.brand} — позиция ${index + 1}`;
    const family = record.family ?? "Не указан";
    const id = createHash("sha256").update(`forge-static-material.v1\0${record.url}\0${index}`).digest("hex");
    records.push({ id, record, displayName, family });
  }
  return { records, found: input.length, rejected };
}

export async function importMaterials(client: PoolClient | null, sourceDirectory: string): Promise<SectionReport> {
  const loaded = await loadMaterials(sourceDirectory);
  let inserted = 0;
  let updated = 0;
  for (const item of loaded.records) {
    if (!client) continue;
    const vendor = resolveVendorName(item.record.brand);
    const vendorResult = await client.query<{ id: string }>(`insert into vendors(slug,name) values($1,$2) on conflict(slug) do update set name=excluded.name returning id`, [vendor.slug, vendor.name]);
    const vendorId = vendorResult.rows[0]?.id;
    if (!vendorId) throw new Error(`vendor upsert returned no id for material ${item.id}`);
    const typeSlug = slug(item.family);
    const typeResult = await client.query<{ id: string }>(`insert into material_types(slug,name) values($1,$2) on conflict(slug) do update set name=excluded.name returning id`, [typeSlug, item.family]);
    const typeId = typeResult.rows[0]?.id;
    if (!typeId) throw new Error(`material type upsert returned no id for ${item.family}`);
    const materialSlug = `forge-${item.id.slice(0, 24)}`;
    const specs = { ...item.record.fields, forge_snapshot: { source_url: item.record.url, evidence: item.record.evidence, original_brand: item.record.brand, original_line_name: item.record.lineName, original_family: item.record.family } };
    const result = await client.query<{ inserted: boolean }>(
      `insert into materials(kind,vendor_id,material_type_id,slug,name,specs,source) values('filament',$1,$2,$3,$4,$5::jsonb,'import')
       on conflict(vendor_id,slug) do update set material_type_id=excluded.material_type_id,name=excluded.name,specs=excluded.specs,updated_at=now()
       returning (xmax = 0) inserted`,
      [vendorId, typeId, materialSlug, item.displayName, JSON.stringify(specs)],
    );
    if (result.rows[0]?.inserted) inserted += 1; else updated += 1;
  }
  return { found: loaded.found, accepted: loaded.records.length, quarantined: 0, rejected: loaded.rejected, inserted, updated, unchanged: client ? 0 : loaded.records.length, warnings: ["each source row is stored as a static material record without entity resolution"] };
}
