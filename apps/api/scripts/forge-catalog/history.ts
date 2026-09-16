import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PoolClient } from "pg";

import { resolveVendorName } from "../../src/modules/catalog/public/operations.ts";
import type { JsonObject, SectionReport } from "./types.ts";
import { isObject, jsonObject, stringValue } from "./types.ts";

interface HistoricalMachine {
  readonly slug: string;
  readonly maker: string;
  readonly model: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly firstYear: number | null;
  readonly fields: JsonObject;
  readonly evidence: JsonObject;
}

function parseHistory(value: unknown): HistoricalMachine | null {
  if (!isObject(value) || value.kind !== "history" || value.outcome !== "staged") return null;
  const slug = stringValue(value.slug);
  const maker = stringValue(value.maker) ?? "Community";
  const model = stringValue(value.model);
  const sourceUrl = stringValue(value.url);
  const license = stringValue(value.license);
  const fields = jsonObject(value.fields);
  const evidence = jsonObject(value.evidence);
  const firstYear = typeof value.first_year === "number" && Number.isInteger(value.first_year) ? value.first_year : null;
  return slug && maker && model && sourceUrl && license && fields && evidence ? { slug, maker, model, sourceUrl, license, firstYear, fields, evidence } : null;
}

export async function loadHistory(sourceDirectory: string): Promise<{ readonly records: readonly HistoricalMachine[]; readonly rejected: number }> {
  const records: HistoricalMachine[] = [];
  let rejected = 0;
  const directory = join(sourceDirectory, "history");
  for (const filename of (await readdir(directory)).filter((name) => name.endsWith(".json")).sort()) {
    const value: unknown = JSON.parse(await readFile(join(directory, filename), "utf8"));
    const record = parseHistory(value);
    if (record) records.push(record); else rejected += 1;
  }
  return { records, rejected };
}

export async function importHistory(client: PoolClient | null, sourceDirectory: string): Promise<SectionReport> {
  const loaded = await loadHistory(sourceDirectory);
  let inserted = 0;
  let updated = 0;
  for (const record of loaded.records) {
    if (!client) continue;
    const vendor = resolveVendorName(record.maker);
    const vendorResult = await client.query<{ id: string }>(`insert into vendors(slug,name) values($1,$2) on conflict(slug) do update set name=excluded.name returning id`, [vendor.slug, vendor.name]);
    const vendorId = vendorResult.rows[0]?.id;
    if (!vendorId) throw new Error(`history vendor upsert returned no id for ${record.slug}`);
    const specs = { ...record.fields, forge_history: { slug: record.slug, source_url: record.sourceUrl, license: record.license, evidence: record.evidence } };
    const existing = await client.query<{ id: string }>(`select id from machines where specs->'forge_history'->>'slug'=$1 limit 1`, [record.slug]);
    if (existing.rows[0]?.id) {
      await client.query(`update machines set vendor_id=$2,model=$3,year=$4,specs=$5::jsonb,source='community',status='active',updated_at=now() where id=$1`, [existing.rows[0].id, vendorId, record.model, record.firstYear, JSON.stringify(specs)]);
      updated += 1;
    } else {
      await client.query(`insert into machines(kind,vendor_id,model,year,specs,source,verified,status) values('fdm_printer',$1,$2,$3,$4::jsonb,'community',false,'active')`, [vendorId, record.model, record.firstYear, JSON.stringify(specs)]);
      inserted += 1;
    }
    const volume = isObject(record.fields.build_volume) ? record.fields.build_volume : {};
    const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    await client.query(
      `insert into printers(slug,brand,model,released_at,status,type,build_volume_x,build_volume_y,build_volume_z,specs,sources,confidence,filled_by,verified,schema_version)
       values($1,$2,$3,$4,'eol','fdm',$5,$6,$7,$8::jsonb,$9,'medium','forge-history',false,'forge.history.v1')
       on conflict(slug) do update set brand=excluded.brand,model=excluded.model,released_at=excluded.released_at,status='eol',type='fdm',build_volume_x=excluded.build_volume_x,build_volume_y=excluded.build_volume_y,build_volume_z=excluded.build_volume_z,specs=excluded.specs,sources=excluded.sources,confidence=excluded.confidence,filled_by=excluded.filled_by,schema_version=excluded.schema_version,updated_at=now()`,
      [record.slug, record.maker, record.model, record.firstYear ? `${record.firstYear}-01-01` : null, number(volume.x), number(volume.y), number(volume.z), JSON.stringify(specs), [record.sourceUrl]],
    );
  }
  return { found: loaded.records.length + loaded.rejected, accepted: loaded.records.length, quarantined: 0, rejected: loaded.rejected, inserted, updated, unchanged: client ? 0 : loaded.records.length, warnings: ["historical licenses and source URLs are preserved in specs.forge_history"] };
}
