import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { readJsonArray, readJsonFile } from "./read-snapshot.ts";
import type { JsonObject, SectionReport } from "./types.ts";
import { isObject, jsonObject, stringValue } from "./types.ts";

type EntityType = "machine" | "printer" | "material" | "vendor";
type Outcome = "matched" | "quarantined";

interface Stats {
  readonly found: number;
  readonly matched: number;
  readonly quarantined: number;
}

interface RecordToStore {
  readonly sourceFile: string;
  readonly sourceKey: string;
  readonly payload: JsonObject;
}

interface Indexes {
  readonly machines: ReadonlyMap<string, { readonly machineId: string; readonly printerId: string | null }>;
  readonly printers: ReadonlyMap<string, string>;
  readonly materialsByFull: ReadonlyMap<string, readonly string[]>;
  readonly materialsByBrandAndLine: ReadonlyMap<string, readonly string[]>;
  readonly materialsByBrandFamily: ReadonlyMap<string, readonly string[]>;
  readonly vendors: ReadonlyMap<string, readonly string[]>;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/[._/\\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function identity(...values: readonly string[]): string {
  return values.map(normalize).join("\u0000");
}

function sourceKey(value: JsonObject, fallback: string): string {
  return stringValue(value.key) ?? stringValue(value.slug) ?? stringValue(value.url) ?? fallback;
}

function snapshotObject(value: unknown): JsonObject | null {
  return jsonObject(value);
}

function add(map: Map<string, string[]>, mapKey: string, id: string): void {
  const ids = map.get(mapKey);
  if (ids === undefined) map.set(mapKey, [id]);
  else if (!ids.includes(id)) ids.push(id);
}

function lookup(map: ReadonlyMap<string, readonly string[]>, mapKey: string): readonly string[] {
  return map.get(mapKey) ?? [];
}

function original(specs: JsonObject, key: string): string | null {
  const snapshot = jsonObject(specs.forge_snapshot);
  return snapshot === null ? null : stringValue(snapshot[key]);
}

async function buildIndexes(client: PoolClient): Promise<Indexes> {
  const machineRows = await client.query<{ id: string; slug: string }>(
    `select id, specs->'forge_snapshot'->>'slug' as slug from machines where specs->'forge_snapshot'->>'slug' is not null
     union all
     select id, specs->'forge_history'->>'slug' as slug from machines where specs->'forge_history'->>'slug' is not null`,
  );
  const printerRows = await client.query<{ id: string; slug: string }>(`select id, slug from printers`);
  const printers = new Map<string, string>();
  for (const row of printerRows.rows) printers.set(normalize(row.slug), row.id);
  const machines = new Map<string, { readonly machineId: string; readonly printerId: string | null }>();
  for (const row of machineRows.rows) {
    const slug = normalize(row.slug);
    machines.set(slug, { machineId: row.id, printerId: printers.get(slug) ?? null });
  }

  const rows = await client.query<{ id: string; brand: string; family: string; name: string; specs: JsonObject }>(
    `select m.id, v.name as brand, mt.name as family, m.name, m.specs
     from materials m join vendors v on v.id=m.vendor_id join material_types mt on mt.id=m.material_type_id`,
  );
  const materialsByFull = new Map<string, string[]>();
  const materialsByBrandAndLine = new Map<string, string[]>();
  const materialsByBrandFamily = new Map<string, string[]>();
  for (const row of rows.rows) {
    const variants = [{ brand: row.brand, family: row.family, line: row.name }];
    const originalBrand = original(row.specs, "original_brand");
    const originalFamily = original(row.specs, "original_family");
    const originalLine = original(row.specs, "original_line_name");
    if (originalBrand && originalFamily && originalLine) variants.push({ brand: originalBrand, family: originalFamily, line: originalLine });
    for (const variant of variants) {
      add(materialsByFull, identity(variant.brand, variant.family, variant.line), row.id);
      add(materialsByBrandAndLine, identity(variant.brand, variant.line), row.id);
      add(materialsByBrandFamily, identity(variant.brand, variant.family), row.id);
    }
  }
  const vendorRows = await client.query<{ id: string; name: string }>(`select id, name from vendors`);
  const vendors = new Map<string, string[]>();
  for (const row of vendorRows.rows) add(vendors, normalize(row.name), row.id);
  return { machines, printers, materialsByFull, materialsByBrandAndLine, materialsByBrandFamily, vendors };
}

async function store(client: PoolClient, record: RecordToStore, outcome: Outcome, entityType: EntityType | null, ids: readonly string[], reason: string | null): Promise<void> {
  const hash = createHash("sha256").update(JSON.stringify(record.payload)).digest();
  await client.query(
    `insert into forge_catalog_import_records(source_file,source_key,payload,content_hash,outcome,matched_entity_type,matched_entity_ids,reason)
     values($1,$2,$3::jsonb,$4,$5,$6,$7::uuid[],$8)
     on conflict(source_file,source_key) do update set payload=excluded.payload,content_hash=excluded.content_hash,outcome=excluded.outcome,matched_entity_type=excluded.matched_entity_type,matched_entity_ids=excluded.matched_entity_ids,reason=excluded.reason,updated_at=now()`,
    [record.sourceFile, record.sourceKey, JSON.stringify(record.payload), hash, outcome, entityType, ids, reason],
  );
}

function makeStats(found: number, matched: number): Stats {
  return { found, matched, quarantined: found - matched };
}

async function descriptions(client: PoolClient, indexes: Indexes, dir: string): Promise<Stats> {
  const values = await readJsonArray(dir, "descriptions.json");
  let matched = 0;
  for (const [position, value] of values.entries()) {
    const payload = snapshotObject(value);
    if (!payload || payload.outcome !== "staged") continue;
    const record = { sourceFile: "descriptions.json", sourceKey: sourceKey(payload, `description:${position}`), payload };
    const text = stringValue(payload.description_ai);
    if (!text) {
      await store(client, record, "quarantined", null, [], "missing description_ai");
      continue;
    }
    const metadata = JSON.stringify({ text, highlights: payload.highlights, generated: true, extractor: payload.extractor, verifier: payload.verifier, generated_at: payload.ts });
    const slug = stringValue(payload.slug);
    if (slug) {
      const found = indexes.machines.get(normalize(slug));
      if (!found) {
        await store(client, record, "quarantined", null, [], "machine slug is absent from the imported catalog");
        continue;
      }
      await client.query(`update machines set specs=jsonb_set(specs,'{ai_description}',$2::jsonb,true),updated_at=now() where id=$1`, [found.machineId, metadata]);
      if (found.printerId) await client.query(`update printers set specs=jsonb_set(specs,'{ai_description}',$2::jsonb,true),updated_at=now() where id=$1`, [found.printerId, metadata]);
      await store(client, record, "matched", "machine", [found.machineId], null);
      matched += 1;
      continue;
    }
    const brand = stringValue(payload.brand);
    const family = stringValue(payload.family);
    const line = stringValue(payload.line);
    const candidates = !brand || !line
      ? []
      : family
        ? lookup(indexes.materialsByFull, identity(brand, family, line))
        : lookup(indexes.materialsByBrandAndLine, identity(brand, line));
    if (candidates.length !== 1) {
      await store(client, record, "quarantined", null, [], candidates.length === 0 ? "material identity is absent from the imported catalog" : "material identity is ambiguous");
      continue;
    }
    await client.query(`update materials set specs=jsonb_set(specs,'{ai_description}',$2::jsonb,true),updated_at=now() where id=$1`, [candidates[0], metadata]);
    await store(client, record, "matched", "material", candidates, null);
    matched += 1;
  }
  return makeStats(values.length, matched);
}

async function prices(client: PoolClient, indexes: Indexes, dir: string): Promise<Stats> {
  const values = await readJsonArray(dir, "prices.json");
  let matched = 0;
  for (const [position, value] of values.entries()) {
    const payload = snapshotObject(value);
    if (!payload || payload.outcome !== "staged") continue;
    const record = { sourceFile: "prices.json", sourceKey: sourceKey(payload, `price:${position}`), payload };
    const slug = stringValue(payload.slug);
    const printerId = slug ? indexes.printers.get(normalize(slug)) : undefined;
    if (!printerId) {
      await store(client, record, "quarantined", null, [], "printer slug is absent from the imported catalog");
      continue;
    }
    const fields = jsonObject(payload.fields);
    const price = fields && typeof fields.price_rub === "number" ? fields.price_rub : null;
    await client.query(
      `update printers set price_ru_rub=coalesce($2,price_ru_rub),price_ru_updated_at=coalesce($3::date,price_ru_updated_at),specs=jsonb_set(specs,'{forge_price}',$4::jsonb,true),updated_at=now() where id=$1`,
      [printerId, price, typeof payload.ts === "string" ? payload.ts.slice(0, 10) : null, JSON.stringify({ shop: payload.shop, url: payload.url, fields: payload.fields, evidence: payload.evidence, observed_at: payload.ts })],
    );
    await store(client, record, "matched", "printer", [printerId], null);
    matched += 1;
  }
  return makeStats(values.length, matched);
}

async function materialEvidence(client: PoolClient, indexes: Indexes, dir: string, filename: "reviews.json" | "summaries.json", specsKey: "forge_reviews" | "forge_review_summary"): Promise<Stats> {
  const values = await readJsonArray(dir, filename);
  const groups = new Map<string, Array<{ readonly record: RecordToStore; readonly value: JsonObject }>>();
  for (const [position, value] of values.entries()) {
    const payload = snapshotObject(value);
    if (!payload || payload.outcome !== "staged") continue;
    const brand = stringValue(payload.brand);
    const family = stringValue(payload.family);
    const groupKey = brand && family ? identity(brand, family) : `missing:${position}`;
    const entries = groups.get(groupKey) ?? [];
    entries.push({ record: { sourceFile: filename, sourceKey: sourceKey(payload, `${filename}:${position}`), payload }, value: payload });
    groups.set(groupKey, entries);
  }
  let matched = 0;
  for (const [groupKey, entries] of groups) {
    const candidates = lookup(indexes.materialsByBrandFamily, groupKey);
    if (candidates.length === 0) {
      for (const entry of entries) await store(client, entry.record, "quarantined", null, [], "material brand and family are absent from the imported catalog");
      continue;
    }
    await client.query(`update materials set specs=jsonb_set(specs,$2::text[],$3::jsonb,true),updated_at=now() where id=any($1::uuid[])`, [candidates, [specsKey], JSON.stringify(entries.map((entry) => entry.value))]);
    for (const entry of entries) await store(client, entry.record, "matched", "material", candidates, null);
    matched += entries.length;
  }
  return makeStats(values.length, matched);
}

async function brands(client: PoolClient, indexes: Indexes, dir: string): Promise<Stats> {
  const value = await readJsonFile(dir, "brands.json");
  const values = isObject(value) && Array.isArray(value.brands) ? value.brands : [];
  let matched = 0;
  for (const [position, value] of values.entries()) {
    const payload = snapshotObject(value);
    if (!payload) continue;
    const record = { sourceFile: "brands.json", sourceKey: sourceKey(payload, `brand:${position}`), payload };
    const name = stringValue(payload.brand);
    const vendorIds = name ? lookup(indexes.vendors, normalize(name)) : [];
    if (vendorIds.length === 0) {
      await store(client, record, "quarantined", null, [], "vendor is absent from the imported catalog");
      continue;
    }
    const metadata = JSON.stringify({ russian: payload.russian === true, shops: payload.shops, lines: payload.lines, source: "RU shops: Cvetmir3D, 3D-DIY, 3DVision" });
    await client.query(`update materials set specs=jsonb_set(specs,'{forge_brand}',$2::jsonb,true),updated_at=now() where vendor_id=any($1::uuid[])`, [vendorIds, metadata]);
    await store(client, record, "matched", "vendor", vendorIds, null);
    matched += 1;
  }
  return makeStats(values.length, matched);
}

export async function importEnrichment(client: PoolClient | null, sourceDirectory: string): Promise<SectionReport> {
  if (!client) {
    const files = await Promise.all(["descriptions.json", "prices.json", "reviews.json", "summaries.json"].map((file) => readJsonArray(sourceDirectory, file)));
    const brandFile = await readJsonFile(sourceDirectory, "brands.json");
    const brandCount = isObject(brandFile) && Array.isArray(brandFile.brands) ? brandFile.brands.length : 0;
    const found = files.reduce((sum, values) => sum + values.length, 0) + brandCount;
    return { found, accepted: found, quarantined: 0, rejected: 0, inserted: 0, updated: 0, unchanged: found, warnings: ["dry-run validates enrichment files; matching and quarantine are evaluated during apply"] };
  }
  const indexes = await buildIndexes(client);
  const details = {
    descriptions: await descriptions(client, indexes, sourceDirectory),
    prices: await prices(client, indexes, sourceDirectory),
    reviews: await materialEvidence(client, indexes, sourceDirectory, "reviews.json", "forge_reviews"),
    summaries: await materialEvidence(client, indexes, sourceDirectory, "summaries.json", "forge_review_summary"),
    brands: await brands(client, indexes, sourceDirectory),
  };
  const parts = Object.values(details);
  const found = parts.reduce((sum, part) => sum + part.found, 0);
  const matched = parts.reduce((sum, part) => sum + part.matched, 0);
  const quarantined = parts.reduce((sum, part) => sum + part.quarantined, 0);
  return { found, accepted: matched, quarantined, rejected: 0, inserted: 0, updated: matched, unchanged: 0, warnings: [`${quarantined} enrichment records were saved in forge_catalog_import_records with an explicit reason`], details };
}
