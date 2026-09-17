import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoolClient } from "pg";

import { resolveVendorName } from "../../src/modules/catalog/public/operations.ts";
import type { ForgeMachine, JsonValue, SectionReport } from "./types.ts";
import { isObject, jsonArray, jsonObject, stringValue } from "./types.ts";

const MACHINE_KINDS = new Set(["fdm_printer", "sla_printer", "cnc_router", "cnc_lathe", "laser_cutter"]);
const INTEGRATIONS = new Set(["live", "in_development", "none"]);
const SOURCES = new Set(["official", "community"]);
const STATUSES = new Set(["active", "quarantined", "archived"]);

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function parseMachine(value: unknown): ForgeMachine | null {
  if (!isObject(value) || value.schema_version !== "forge.machine.v1") return null;
  const slug = stringValue(value.slug);
  const vendor = jsonObject(value.vendor);
  const machine = jsonObject(value.machine);
  const specs = jsonObject(value.specs);
  const fieldProvenance = jsonObject(value.field_provenance);
  const conflicts = value.conflicts === undefined ? [] : jsonArray(value.conflicts);
  if (!slug || !vendor || !machine || !specs || !fieldProvenance || !conflicts) return null;
  const vendorSlug = stringValue(vendor.slug);
  const vendorName = stringValue(vendor.name);
  const model = stringValue(machine.model);
  const kind = stringValue(machine.kind);
  const integration = stringValue(machine.integration);
  const source = stringValue(machine.source);
  const status = stringValue(machine.status);
  const aliases = stringArray(machine.aliases);
  if (!vendorSlug || !vendorName || !model || !kind || !integration || !source || !status || !aliases) return null;
  if (!MACHINE_KINDS.has(kind) || !INTEGRATIONS.has(integration) || !SOURCES.has(source) || !STATUSES.has(status)) return null;
  if (!(kind === "fdm_printer" || kind === "sla_printer" || kind === "cnc_router" || kind === "cnc_lathe" || kind === "laser_cutter")) return null;
  if (!(integration === "live" || integration === "in_development" || integration === "none")) return null;
  if (!(source === "official" || source === "community")) return null;
  if (!(status === "active" || status === "quarantined" || status === "archived")) return null;
  return { schemaVersion: "forge.machine.v1", slug, vendor: { slug: vendorSlug, name: vendorName }, machine: { kind, model, aliases, integration, source, verified: machine.verified === true, status }, specs, fieldProvenance, conflicts };
}

export async function loadMachines(sourceDirectory: string): Promise<{ readonly records: readonly ForgeMachine[]; readonly rejected: number }> {
  const root = join(sourceDirectory, "machines");
  const records: ForgeMachine[] = [];
  let rejected = 0;
  const vendors = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name));
  for (const vendor of vendors) {
    const directory = join(root, vendor.name);
    for (const filename of (await readdir(directory)).filter((name) => name.endsWith(".json")).sort()) {
      const parsed: unknown = JSON.parse(await readFile(join(directory, filename), "utf8"));
      const machine = parseMachine(parsed);
      if (machine) records.push(machine);
      else rejected += 1;
    }
  }
  return { records, rejected };
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function machineContentHash(machine: ForgeMachine): Buffer {
  return createHash("sha256")
    .update(canonicalJson({ vendor: machine.vendor.slug, model: machine.machine.model, specs: machine.specs }))
    .digest();
}

function numberSpec(machine: ForgeMachine, key: string): number | null {
  const value = machine.specs[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanSpec(machine: ForgeMachine, key: string): boolean | null {
  const value = machine.specs[key];
  return typeof value === "boolean" ? value : null;
}

function objectSpec(machine: ForgeMachine, key: string): Readonly<Record<string, JsonValue>> {
  const value = machine.specs[key];
  return isObject(value) ? value : {};
}

function objectNumber(value: Readonly<Record<string, JsonValue>>, key: string): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function publicStatus(machine: ForgeMachine): "announced" | "shipping" | "eol" {
  if (machine.machine.status === "archived") return "eol";
  const releaseStatus = machine.specs.release_status;
  return releaseStatus === "announced" || releaseStatus === "eol" ? releaseStatus : "shipping";
}

export function publicPrinterType(kind: ForgeMachine["machine"]["kind"]): "fdm" | "resin-sla" | null {
  if (kind === "fdm_printer") return "fdm";
  if (kind === "sla_printer") return "resin-sla";
  return null;
}

async function upsertPublicPrinter(client: PoolClient, record: ForgeMachine): Promise<void> {
  const printerType = publicPrinterType(record.machine.kind);
  if (printerType === null) return;
  const volume = objectSpec(record, "build_volume");
  const dimensions = objectSpec(record, "dimensions_mm");
  const kinematics = typeof record.specs.kinematics === "string" && new Set(["cartesian", "corexy", "delta", "scara", "idex", "polar", "belt"]).has(record.specs.kinematics) ? record.specs.kinematics : null;
  const sourceUrls = [...new Set(Object.values(record.fieldProvenance).flatMap((value) => isObject(value) && typeof value.source_url === "string" ? [value.source_url] : []))];
  const sources = sourceUrls.length > 0 ? sourceUrls : [`forge:${record.slug}`];
  const publicSpecs = {
    ...record.specs,
    build_volume: volume,
    speed: { max_speed_mms: numberSpec(record, "max_speed_mms"), max_accel_mms2: numberSpec(record, "max_accel_mms2") },
    hotend: { max_temp_c: numberSpec(record, "max_nozzle_temp_c"), hardened: booleanSpec(record, "nozzle_hardened") },
    bed: { max_temp_c: numberSpec(record, "max_bed_temp_c"), auto_leveling: typeof record.specs.auto_leveling === "string" ? record.specs.auto_leveling : null },
    dimensions_mm: { ...dimensions, weight_kg: numberSpec(record, "weight_kg") },
    forge_snapshot: { slug: record.slug, conflicts: record.conflicts, schema_version: record.schemaVersion },
  };
  await client.query(
    `insert into printers(slug,brand,model,aliases,status,kinematics,type,enclosed,build_volume_x,build_volume_y,build_volume_z,hotend_max_temp_c,hotend_hardened,bed_max_temp_c,specs,sources,field_provenance,confidence,filled_by,verified,schema_version)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17::jsonb,$18,'forge-static',false,'forge.machine.v1')
     on conflict(slug) do update set brand=excluded.brand,model=excluded.model,aliases=excluded.aliases,status=excluded.status,kinematics=excluded.kinematics,type=excluded.type,enclosed=excluded.enclosed,build_volume_x=excluded.build_volume_x,build_volume_y=excluded.build_volume_y,build_volume_z=excluded.build_volume_z,hotend_max_temp_c=excluded.hotend_max_temp_c,hotend_hardened=excluded.hotend_hardened,bed_max_temp_c=excluded.bed_max_temp_c,specs=excluded.specs,sources=excluded.sources,field_provenance=excluded.field_provenance,confidence=excluded.confidence,filled_by=excluded.filled_by,schema_version=excluded.schema_version,updated_at=now()`,
    [record.slug, record.vendor.name, record.machine.model, record.machine.aliases, publicStatus(record), kinematics, printerType, booleanSpec(record, "enclosed"), objectNumber(volume, "x"), objectNumber(volume, "y"), objectNumber(volume, "z"), numberSpec(record, "max_nozzle_temp_c"), booleanSpec(record, "nozzle_hardened"), numberSpec(record, "max_bed_temp_c"), JSON.stringify(publicSpecs), sources, JSON.stringify(record.fieldProvenance), record.conflicts.length > 0 ? "low" : "medium"],
  );
}

export async function importMachines(client: PoolClient | null, sourceDirectory: string): Promise<SectionReport> {
  const loaded = await loadMachines(sourceDirectory);
  let inserted = 0;
  let updated = 0;
  for (const record of loaded.records) {
    if (!client) continue;
    const vendor = resolveVendorName(record.vendor.name);
    const vendorResult = await client.query<{ id: string }>(`insert into vendors(slug,name) values($1,$2) on conflict(slug) do update set name=excluded.name returning id`, [vendor.slug, vendor.name]);
    const vendorId = vendorResult.rows[0]?.id;
    if (!vendorId) throw new Error(`vendor upsert returned no id for ${record.slug}`);
    const specs = {
      ...record.specs,
      forge_snapshot: {
        schema_version: record.schemaVersion,
        slug: record.slug,
        conflicts: record.conflicts,
      },
    };
    const existing = await client.query<{ id: string }>(
      `select id from machines where specs->'forge_snapshot'->>'slug'=$1 order by created_at limit 1`,
      [record.slug],
    );
    const existingId = existing.rows[0]?.id;
    const values = [record.machine.kind, vendorId, record.machine.model, record.machine.aliases, JSON.stringify(specs), record.machine.integration, record.machine.source, JSON.stringify(record.fieldProvenance), record.machine.status, machineContentHash(record)];
    if (existingId) {
      await client.query(
        `update machines set kind=$2,vendor_id=$3,model=$4,aliases=$5,specs=$6::jsonb,integration=$7,source=$8,verified=false,field_provenance=$9::jsonb,status=$10,content_hash=$11,updated_at=now() where id=$1`,
        [existingId, ...values],
      );
      updated += 1;
    } else {
      await client.query(
        `insert into machines(kind,vendor_id,model,aliases,specs,integration,source,verified,field_provenance,status,content_hash) values($1,$2,$3,$4,$5::jsonb,$6,$7,false,$8::jsonb,$9,$10)`,
        values,
      );
      inserted += 1;
    }
    await upsertPublicPrinter(client, record);
  }
  return { found: loaded.records.length + loaded.rejected, accepted: loaded.records.length, quarantined: 0, rejected: loaded.rejected, inserted, updated, unchanged: client ? 0 : loaded.records.length, warnings: ["source conflicts are preserved in specs.forge_snapshot.conflicts"] };
}
