import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Dirent } from "node:fs";
import type { PoolClient } from "pg";

import type { JsonObject, JsonValue, SectionReport } from "./types.ts";
import { isObject, jsonArray, jsonObject, stringValue } from "./types.ts";

interface OfdVariant {
  readonly colorName: string;
  readonly colorHex: string | null;
  readonly diameterMm: number;
  readonly weightG: number | null;
  readonly externalRef: string | null;
  readonly confidence: number | null;
  readonly raw: JsonObject;
}

interface OfdMaterial {
  readonly slug: string;
  readonly vendor: { readonly slug: string; readonly name: string; readonly website: string | null };
  readonly materialType: { readonly slug: string; readonly name: string };
  readonly name: string;
  readonly specs: JsonObject;
  readonly provenance: JsonObject;
  readonly evidence: JsonObject;
  readonly sources: readonly JsonValue[];
  readonly variants: readonly OfdVariant[];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseVariant(value: JsonValue): OfdVariant | null {
  if (!isObject(value)) return null;
  const colorName = stringValue(value.color_name);
  const diameterMm = finiteNumber(value.diameter_mm);
  const raw = jsonObject(value);
  if (!colorName || diameterMm === null || diameterMm <= 0 || !raw) return null;
  return {
    colorName,
    colorHex: typeof value.color_hex === "string" && /^#[0-9a-f]{6}$/i.test(value.color_hex) ? value.color_hex.toLowerCase() : null,
    diameterMm,
    weightG: finiteNumber(value.weight_g),
    externalRef: stringValue(value.external_ref),
    confidence: finiteNumber(value.confidence),
    raw,
  };
}

function parseOfd(value: unknown): OfdMaterial | null {
  if (!isObject(value) || value.schema_version !== "forge.filament.v1") return null;
  const slug = stringValue(value.slug);
  const vendor = jsonObject(value.vendor);
  const materialType = jsonObject(value.material_type);
  const material = jsonObject(value.material);
  const variants = value.variants === undefined ? [] : jsonArray(value.variants);
  const provenance = jsonObject(value.field_provenance) ?? {};
  const evidence = jsonObject(value.evidence) ?? {};
  const sources = jsonArray(value.sources) ?? [];
  if (!slug || !vendor || !materialType || !material || !variants || material.kind !== "filament") return null;
  const vendorSlug = stringValue(vendor.slug);
  const vendorName = stringValue(vendor.name);
  const typeSlug = stringValue(materialType.slug);
  const typeName = stringValue(materialType.name);
  const name = stringValue(material.name);
  const specs = jsonObject(material.specs);
  if (!vendorSlug || !vendorName || !typeSlug || !typeName || !name || !specs) return null;
  const parsedVariants = variants.map(parseVariant).filter((variant): variant is OfdVariant => variant !== null);
  return { slug, vendor: { slug: vendorSlug, name: vendorName, website: stringValue(vendor.website) }, materialType: { slug: typeSlug, name: typeName }, name, specs, provenance, evidence, sources, variants: parsedVariants };
}

async function jsonFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries: Dirent[] = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) files.push(path);
    }
  }
  await walk(root);
  return files;
}

export async function loadOfdMaterials(sourceDirectory: string): Promise<{ readonly records: readonly OfdMaterial[]; readonly rejected: number }> {
  const records: OfdMaterial[] = [];
  let rejected = 0;
  for (const file of await jsonFiles(join(sourceDirectory, "materials.ofd"))) {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    const record = parseOfd(value);
    if (record) records.push(record);
    else rejected += 1;
  }
  return { records, rejected };
}

export async function importOfdMaterials(client: PoolClient | null, sourceDirectory: string): Promise<SectionReport> {
  const loaded = await loadOfdMaterials(sourceDirectory);
  let inserted = 0;
  let updated = 0;
  let variantCount = 0;
  for (const record of loaded.records) {
    variantCount += record.variants.length;
    if (!client) continue;
    const vendorResult = await client.query<{ id: string }>(
      `insert into vendors(slug,name,website) values($1,$2,$3) on conflict(slug) do update set name=excluded.name,website=coalesce(excluded.website,vendors.website),updated_at=now() returning id`,
      [record.vendor.slug, record.vendor.name, record.vendor.website],
    );
    const vendorId = vendorResult.rows[0]?.id;
    if (!vendorId) throw new Error(`OFD vendor upsert returned no id for ${record.slug}`);
    const typeResult = await client.query<{ id: string }>(
      `insert into material_types(slug,name) values($1,$2) on conflict(slug) do update set name=excluded.name returning id`,
      [record.materialType.slug, record.materialType.name],
    );
    const typeId = typeResult.rows[0]?.id;
    if (!typeId) throw new Error(`OFD material type upsert returned no id for ${record.slug}`);
    const materialSlug = `ofd-${record.slug.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
    const specs = { ...record.specs, forge_ofd: { slug: record.slug, field_provenance: record.provenance, evidence: record.evidence, sources: record.sources, variants: record.variants.map((variant) => variant.raw) } };
    const materialResult = await client.query<{ id: string; inserted: boolean }>(
      `insert into materials(kind,vendor_id,material_type_id,slug,name,specs,source,status) values('filament',$1,$2,$3,$4,$5::jsonb,'import','published')
       on conflict(vendor_id,slug) do update set material_type_id=excluded.material_type_id,name=excluded.name,specs=excluded.specs,status='published',archived_at=null,updated_at=now()
       returning id,(xmax=0) inserted`,
      [vendorId, typeId, materialSlug, record.name, JSON.stringify(specs)],
    );
    const material = materialResult.rows[0];
    if (!material) throw new Error(`OFD material upsert returned no id for ${record.slug}`);
    if (material.inserted) inserted += 1; else updated += 1;
    const uniqueVariants = new Map<string, OfdVariant>();
    for (const variant of record.variants) uniqueVariants.set(`${variant.colorName}\0${variant.diameterMm}`, variant);
    for (const variant of uniqueVariants.values()) {
      await client.query(
        `insert into material_variants(material_id,color_name,color_hex,diameter_mm,weight_g,specs,source,confidence,external_ref)
         values($1,$2,$3,$4,$5,$6::jsonb,'import',$7,$8)
         on conflict(material_id,color_name,diameter_mm) do update set color_hex=excluded.color_hex,weight_g=excluded.weight_g,specs=excluded.specs,confidence=excluded.confidence,external_ref=excluded.external_ref,updated_at=now()`,
        [material.id, variant.colorName, variant.colorHex, variant.diameterMm, variant.weightG, JSON.stringify({ forge_ofd: variant.raw }), variant.confidence, variant.externalRef],
      );
    }
  }
  return { found: loaded.records.length + loaded.rejected, accepted: loaded.records.length, quarantined: 0, rejected: loaded.rejected, inserted, updated, unchanged: client ? 0 : loaded.records.length, warnings: [`${variantCount} OFD source variants are preserved; DB variants are deduplicated by material/color/diameter`] };
}
