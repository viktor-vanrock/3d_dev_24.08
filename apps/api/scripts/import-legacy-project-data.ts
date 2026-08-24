#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";

const ACCEPTED_SOURCE_SCHEMAS: Readonly<Record<string, string>> = {
  "24f83d1a4e9d24133425b1f6926c5f431a12025969d445d7def2c86ae600cd21": "portal-dev",
  ef1f0e9ffc0eb4affa3ec873380faed3f2a0ff301515feba57528cc37e861336: "portal-devcontainer",
  "839ffe98771b45f876d91d47a0238418a5f613df3e6056a771ed7c1d52af1162": "portal-prod",
};
const SOURCE_SCHEMA_TABLES = ["users", "models", "model_files", "model_tags", "tags"] as const;
const SOURCE_FORMATS = new Set(["stl", "obj", "3mf", "step", "dxf", "svg", "gcode", "gerber", "zip"]);
const CRAFTS = new Set(["3d_printing", "cnc", "electronics", "software"]);
const METHODS = new Set(["fdm", "sla", "cnc", "laser"]);
const FILE_ROLES = new Set([
  "source",
  "canonical_3mf",
  "preview",
  "thumbnail",
  "cnc_program",
  "drawing",
  "gerber",
  "code_archive",
  "aux",
  "description_image",
  "mobile_preview",
  "project_doc",
  "stl_derivative",
]);
const SINGULAR_ROLES = new Set(["source", "canonical_3mf", "preview", "thumbnail", "mobile_preview", "stl_derivative"]);
const SOURCE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  stl: [".stl"],
  obj: [".obj"],
  "3mf": [".3mf"],
  step: [".step", ".stp"],
  dxf: [".dxf"],
  svg: [".svg"],
  gcode: [".gcode", ".g", ".nc", ".tap", ".cnc"],
  gerber: [".gbr", ".gtl", ".gbl", ".gto", ".gbo", ".gts", ".gbs", ".gko", ".drl", ".ger"],
  zip: [".zip"],
};
const IMPORTED_RELATIONS = new Set(["models", "model_files", "model_tags", "tags", "users", "import_bindings"]);
const EPHEMERAL_RELATIONS = new Set([
  "model_download_log",
  "model_upload_idempotency",
  "model_fork_idempotency",
  "model_view_log",
  "model_embeddings",
  "model_meshes",
  "search_index_jobs",
  "slice_cache_hits",
  "slice_jobs",
]);

interface Options {
  sourceUrl: string;
  targetUrl: string;
  dump: string;
  objectSource: string;
  objectTarget: string;
  ownerMap: string;
  report: string;
  apply: boolean;
}

interface LegacyUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  handle_confirmed: boolean;
  is_staff: boolean;
  reputation_score: number;
  trust_level: number;
  trust_level_manual: boolean;
  role: string;
  bio: string | null;
  website_url: string | null;
  contacts: unknown;
  maker_verified: boolean;
  is_master: boolean | null;
  master_profile: unknown;
}

interface LegacyModel {
  id: string;
  owner_id: string;
  title: string;
  source_format: string;
  status: string;
  craft: string;
  bbox: unknown;
  created_at: Date;
  updated_at: Date;
  description: string | null;
  votes_up: number;
  votes_down: number;
  downloads_count: number;
  recommended_material_id: string | null;
  repo_url: string | null;
  featured_at: Date | null;
  repo_path: string | null;
  forked_from: string | null;
  publish_status: string;
  comments_count: number;
  makes_count: number;
  views_count: number;
  price_minor: string;
  currency: string;
  remixes_count: number;
  manufacturing_method: string | null;
  requires_ams: boolean | null;
}

interface LegacyFile {
  id: string;
  model_id: string;
  role: string;
  s3_key: string | null;
  size_bytes: string;
  checksum: Buffer;
  created_at: Date;
  original_filename: string | null;
  mime_type: string | null;
}

interface VerifiedFile extends LegacyFile {
  sourcePath: string;
  checksumHex: string;
  targetKey: string;
}

interface PlannedModel {
  legacy: LegacyModel;
  projectId: string;
  modelId: string;
  revisionId: string;
  ownerId: string;
  revisionStatus: "ready" | "uploaded" | "failed";
  verifiedFiles: VerifiedFile[];
  source: VerifiedFile | null;
  regenerationRoles: string[];
  quarantineReason: string | null;
}

interface Report {
  contract_version: "legacy-project-import.v1";
  mode: "dry-run" | "apply";
  source: { dump_file: string; dump_sha256: string; schema_profile: string; schema_fingerprint: string };
  target: { baseline_version: "20260810150000"; was_empty: boolean };
  counts: Record<string, number>;
  relation_accounting: Record<string, { disposition: "imported" | "excluded_ephemeral" | "excluded_deferred"; rows: number }>;
  invariants: { unmapped_owners: number; orphan_rows: number; cross_owner_rows: number; invalid_publications: number; unaccounted_rows: number };
  warnings: Record<string, number>;
  mapping_digest: string;
  accepted: boolean;
}

function usage(message?: string): never {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(
    "usage: import-legacy-project-data --source-url URL --target-url URL --dump FILE --object-source none|fs:DIR --object-target none|fs:DIR --owner-map FILE --report FILE [--apply]\n",
  );
  process.exit(2);
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") continue;
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") continue;
    if (!arg.startsWith("--")) usage(`unknown argument: ${arg}`);
    const split = arg.indexOf("=");
    const name = split === -1 ? arg : arg.slice(0, split);
    const value = split === -1 ? argv[++index] : arg.slice(split + 1);
    if (!value) usage(`missing value for ${name}`);
    values.set(name, value);
  }
  const required = (name: string) => values.get(name) ?? usage(`missing ${name}`);
  return {
    sourceUrl: required("--source-url"),
    targetUrl: required("--target-url"),
    dump: resolve(required("--dump")),
    objectSource: required("--object-source"),
    objectTarget: required("--object-target"),
    ownerMap: resolve(required("--owner-map")),
    report: resolve(required("--report")),
    apply,
  };
}

export function stableUuid(seed: string, kind: string, legacyId: string): string {
  const bytes = createHash("sha256").update(`legacy-project-import.v1\0${seed}\0${kind}\0${legacyId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function fingerprintSchemaLines(lines: readonly string[]): string {
  return createHash("sha256")
    .update(`${lines.join("\n")}\n`)
    .digest("hex");
}

async function sourceSchema(pool: Pool): Promise<{ fingerprint: string; profile: string; columns: Map<string, Set<string>> }> {
  const rows = (
    await pool.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `select table_name,column_name,data_type,is_nullable from information_schema.columns
      where table_schema='public' and table_name=any($1::text[]) order by table_name,ordinal_position`,
      [SOURCE_SCHEMA_TABLES],
    )
  ).rows;
  const lines = rows.map((row) => `${row.table_name}.${row.column_name}:${row.data_type}:${row.is_nullable}`);
  const fingerprint = fingerprintSchemaLines(lines);
  const profile = ACCEPTED_SOURCE_SCHEMAS[fingerprint];
  if (!profile) throw new Error(`unsupported source schema fingerprint ${fingerprint}`);
  const columns = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = columns.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    columns.set(row.table_name, set);
  }
  return { fingerprint, profile, columns };
}

function optionalColumn(columns: Set<string>, name: string, fallback: string): string {
  return columns.has(name) ? name : `${fallback} as ${name}`;
}

async function assertEmptyTarget(pool: Pool): Promise<void> {
  const migration = await pool.query<{ version: string }>(`select version from schema_migrations order by version desc limit 1`);
  if (migration.rows[0]?.version !== "20260810150000") throw new Error("target is not the Project API v1 baseline");
  const legacyViews = await pool.query(`select 1 from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])`, [
    ["models_compat_v1", "project_read_v1", "model_files"],
  ]);
  if ((legacyViews.rowCount ?? 0) !== 0) throw new Error("target contains a legacy compatibility object");
  const counts = await pool.query<{ users: string; projects: string; models: string }>(
    `select (select count(*) from users) users,(select count(*) from projects) projects,(select count(*) from models) models`,
  );
  const row = counts.rows[0]!;
  if (Number(row.users) !== 0 || Number(row.projects) !== 0 || Number(row.models) !== 0) throw new Error("target must be empty");
}

function objectRoot(value: string, option: string): string | null {
  if (value === "none") return null;
  if (!value.startsWith("fs:")) usage(`${option} must be none or fs:DIR`);
  const root = resolve(value.slice(3));
  if (!isAbsolute(root)) usage(`${option} must resolve to an absolute path`);
  return root;
}

function safeObjectPath(root: string, key: string): string | null {
  const candidate = resolve(root, key.replace(/^\/+/, ""));
  const rel = relative(root, candidate);
  return rel === "" || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ? null : candidate;
}

async function verifyFile(file: LegacyFile, root: string | null): Promise<VerifiedFile | null> {
  if (root === null || file.s3_key === null || !Buffer.isBuffer(file.checksum) || file.checksum.length !== 32) return null;
  const sourcePath = safeObjectPath(root, file.s3_key);
  if (sourcePath === null) return null;
  let size: number;
  try {
    size = (await stat(sourcePath)).size;
  } catch {
    return null;
  }
  if (size !== Number(file.size_bytes)) return null;
  const checksumHex = await sha256File(sourcePath);
  if (checksumHex !== file.checksum.toString("hex")) return null;
  return { ...file, sourcePath, checksumHex, targetKey: `legacy-import/sha256/${checksumHex.slice(0, 2)}/${checksumHex}` };
}

async function relationAccounting(source: Pool): Promise<{ accounting: Report["relation_accounting"]; unaccounted: number }> {
  const tables = (
    await source.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns where table_schema='public' and column_name='model_id' order by table_name`,
    )
  ).rows.map((row) => row.table_name);
  const accounting: Report["relation_accounting"] = {};
  let unaccounted = 0;
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("unsafe source table name");
    const count = Number((await source.query<{ count: string }>(`select count(*) from ${table}`)).rows[0]!.count);
    const disposition = IMPORTED_RELATIONS.has(table) ? "imported" : EPHEMERAL_RELATIONS.has(table) ? "excluded_ephemeral" : "excluded_deferred";
    accounting[table] = { disposition, rows: count };
    if (!IMPORTED_RELATIONS.has(table) && !EPHEMERAL_RELATIONS.has(table) && disposition !== "excluded_deferred") unaccounted += count;
  }
  return { accounting, unaccounted };
}

async function countExistingTables(source: Pool, tables: readonly string[]): Promise<number> {
  const existing = (
    await source.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public' and table_name=any($1::text[])`, [tables])
  ).rows;
  let total = 0;
  for (const { table_name: table } of existing) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("unsafe source table name");
    total += Number((await source.query<{ count: string }>(`select count(*) from ${table}`)).rows[0]!.count);
  }
  return total;
}

function sourceFilenameMatches(file: VerifiedFile, sourceFormat: string): boolean {
  const name = (file.original_filename ?? file.s3_key ?? "").toLowerCase();
  return (SOURCE_EXTENSIONS[sourceFormat] ?? []).some((extension) => name.endsWith(extension));
}

async function loadOwnerMap(path: string): Promise<Map<string, string>> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("owner map must be a JSON object");
  const map = new Map<string, string>();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const [legacyId, targetId] of Object.entries(parsed as Record<string, unknown>)) {
    if (!uuid.test(legacyId) || typeof targetId !== "string" || !uuid.test(targetId)) throw new Error("owner map contains an invalid UUID");
    if (legacyId === targetId) throw new Error("owner map must assign new target UUIDs");
    map.set(legacyId, targetId);
  }
  if (new Set(map.values()).size !== map.size) throw new Error("owner map target UUIDs must be unique");
  return map;
}

async function insertPlan(
  client: PoolClient,
  seed: string,
  users: LegacyUser[],
  plans: PlannedModel[],
  tags: Array<{ id: string; name: string; created_at: Date }>,
  modelTags: Array<{ model_id: string; tag_id: string }>,
  imports: Array<Record<string, unknown>>,
  ownerMap: Map<string, string>,
  objectTarget: string | null,
): Promise<void> {
  const usersById = new Map(users.map((user) => [user.id, user]));
  for (const legacyOwnerId of [...new Set(plans.map((plan) => plan.legacy.owner_id))].sort()) {
    const user = usersById.get(legacyOwnerId)!;
    const targetId = ownerMap.get(legacyOwnerId)!;
    await client.query(
      `insert into users(id,username,display_name,avatar_url,status,created_at,updated_at,handle_confirmed,is_staff,reputation_score,trust_level,trust_level_manual,role,bio,website_url,contacts,maker_verified,is_master,master_profile)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        targetId,
        user.username,
        user.display_name,
        user.avatar_url,
        user.status,
        user.created_at,
        user.updated_at,
        user.handle_confirmed,
        user.is_staff,
        user.reputation_score,
        user.trust_level,
        user.trust_level_manual,
        user.role === "researcher" ? "researcher" : "user",
        user.bio,
        user.website_url,
        JSON.stringify(user.contacts),
        user.maker_verified,
        user.is_master ?? false,
        user.master_profile === null ? null : JSON.stringify(user.master_profile),
      ],
    );
  }
  const referencedTagIds = new Set(modelTags.map((row) => row.tag_id));
  const tagMap = new Map<string, string>();
  for (const tag of tags.filter((row) => referencedTagIds.has(row.id))) {
    const targetId = stableUuid(seed, "tag", tag.id);
    tagMap.set(tag.id, targetId);
    await client.query(`insert into tags(id,name,created_at) values($1,$2,$3) on conflict(name) do nothing`, [targetId, tag.name, tag.created_at]);
  }
  for (const plan of plans) {
    const markerChecksum = createHash("sha256").update(`quarantine\0${seed}\0${plan.legacy.id}`).digest();
    const sourceChecksum = plan.source?.checksum ?? markerChecksum;
    const sourceSize = plan.source ? Number(plan.source.size_bytes) : 0;
    const activeRevisionId = plan.revisionStatus === "ready" ? plan.revisionId : null;
    await client.query(
      `insert into projects(id,owner_id,title,description,votes_up,votes_down,downloads_count,recommended_material_id,repo_url,featured_at,repo_path,comments_count,makes_count,views_count,price_minor,currency,remixes_count,primary_model_id,published_revision_id,version,created_at,updated_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,null,null,1,$18,$19)`,
      [
        plan.projectId,
        plan.ownerId,
        plan.legacy.title.slice(0, 200),
        plan.legacy.description,
        plan.legacy.votes_up,
        plan.legacy.votes_down,
        plan.legacy.downloads_count,
        null,
        plan.legacy.repo_url,
        plan.legacy.featured_at,
        plan.legacy.repo_path,
        plan.legacy.comments_count,
        plan.legacy.makes_count,
        plan.legacy.views_count,
        plan.legacy.price_minor,
        plan.legacy.currency,
        plan.legacy.remixes_count,
        plan.legacy.created_at,
        plan.legacy.updated_at,
      ],
    );
    await client.query(`insert into models(id,project_id,name,position,latest_revision_id,active_revision_id,version,created_at,updated_at) values($1,$2,$3,0,$4,$5,1,$6,$7)`, [
      plan.modelId,
      plan.projectId,
      plan.legacy.title.slice(0, 120),
      plan.revisionId,
      activeRevisionId,
      plan.legacy.created_at,
      plan.legacy.updated_at,
    ]);
    await client.query(
      `insert into model_revisions(id,model_id,source_format,bbox,status,craft,manufacturing_method,requires_ams,source_checksum,source_size_bytes,failure_code,failure_detail_safe,created_at,ready_at,failed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        plan.revisionId,
        plan.modelId,
        plan.legacy.source_format,
        plan.revisionStatus === "ready" ? plan.legacy.bbox : null,
        plan.revisionStatus,
        CRAFTS.has(plan.legacy.craft) ? plan.legacy.craft : "3d_printing",
        METHODS.has(plan.legacy.manufacturing_method ?? "") ? plan.legacy.manufacturing_method : null,
        plan.legacy.requires_ams ?? false,
        sourceChecksum,
        sourceSize,
        plan.quarantineReason === null ? null : "legacy_source_quarantined",
        plan.quarantineReason,
        plan.legacy.created_at,
        plan.revisionStatus === "ready" ? plan.legacy.updated_at : null,
        plan.revisionStatus === "failed" ? plan.legacy.updated_at : null,
      ],
    );
    await client.query(`update projects set primary_model_id=$2 where id=$1`, [plan.projectId, plan.modelId]);
    for (const file of plan.verifiedFiles) {
      const blobId = stableUuid(seed, "blob", `${plan.ownerId}:${file.checksumHex}`);
      const fileId = stableUuid(seed, "revision-file", file.id);
      await client.query(
        `insert into storage_blobs(id,owner_id,checksum,size_bytes,s3_key,state,created_at,updated_at) values($1,$2,$3,$4,$5,'ready',$6,$6) on conflict(owner_id,checksum,size_bytes) do nothing`,
        [blobId, plan.ownerId, file.checksum, Number(file.size_bytes), file.targetKey, file.created_at],
      );
      const resolvedBlob = await client.query<{ id: string }>(`select id from storage_blobs where owner_id=$1 and checksum=$2 and size_bytes=$3`, [
        plan.ownerId,
        file.checksum,
        Number(file.size_bytes),
      ]);
      await client.query(
        `insert into model_revision_files(id,model_revision_id,role,size_bytes,checksum,created_at,original_filename,mime_type,blob_id,is_source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          fileId,
          plan.revisionId,
          file.role,
          Number(file.size_bytes),
          file.checksum,
          file.created_at,
          file.original_filename,
          file.mime_type ?? "application/octet-stream",
          resolvedBlob.rows[0]!.id,
          file === plan.source,
        ],
      );
      if (objectTarget !== null) {
        const destination = safeObjectPath(objectTarget, file.targetKey);
        if (destination === null) throw new Error("unsafe target object path");
        await mkdir(resolve(destination, ".."), { recursive: true });
        await copyFile(file.sourcePath, destination);
      }
    }
    if (plan.revisionStatus === "uploaded") {
      await client.query(
        `insert into outbox_events(aggregate_type,aggregate_id,event_type,event_version,payload) values('ModelRevision',$1,'model.revision.uploaded.v1',1,jsonb_build_object('project_id',$2,'model_id',$3,'revision_id',$1,'source','legacy-import'))`,
        [plan.revisionId, plan.projectId, plan.modelId],
      );
    } else if (plan.revisionStatus === "ready" && plan.regenerationRoles.length > 0) {
      await client.query(
        `insert into outbox_events(aggregate_type,aggregate_id,event_type,event_version,payload) values('ModelRevision',$1,'model.derivatives.regenerate.v1',1,jsonb_build_object('project_id',$2,'model_id',$3,'revision_id',$1,'roles',$4::text[],'source','legacy-import'))`,
        [plan.revisionId, plan.projectId, plan.modelId, plan.regenerationRoles],
      );
    }
  }
  const planByLegacy = new Map(plans.map((plan) => [plan.legacy.id, plan]));
  for (const plan of plans) {
    const fork = plan.legacy.forked_from === null ? null : (planByLegacy.get(plan.legacy.forked_from)?.projectId ?? null);
    if (fork !== null) await client.query(`update projects set forked_from=$2 where id=$1`, [plan.projectId, fork]);
  }
  for (const row of modelTags) {
    const project = planByLegacy.get(row.model_id);
    const tagId = tagMap.get(row.tag_id);
    if (project && tagId) await client.query(`insert into model_tags(model_id,tag_id) values($1,$2) on conflict do nothing`, [project.projectId, tagId]);
  }
  for (const binding of imports) {
    const project = planByLegacy.get(String(binding.model_id));
    if (!project) continue;
    if (String(binding.user_id) !== project.legacy.owner_id) throw new Error("cross-owner import binding");
    await client.query(
      `insert into import_bindings(id,model_id,connection_id,user_id,source_platform,external_id,original_url,source_license,source_popularity,ownership_status,imported_at,created_at,updated_at)
       values($1,$2,null,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        stableUuid(seed, "import-binding", String(binding.id)),
        project.modelId,
        project.ownerId,
        binding.source_platform,
        binding.external_id,
        binding.original_url,
        binding.source_license,
        binding.source_popularity,
        binding.ownership_status,
        binding.imported_at,
        binding.created_at,
        binding.updated_at,
      ],
    );
  }
  for (const plan of plans.filter((item) => item.revisionStatus === "ready" && item.legacy.publish_status === "published")) {
    const tagNames = modelTags
      .filter((row) => row.model_id === plan.legacy.id)
      .map((row) => tags.find((tag) => tag.id === row.tag_id)?.name)
      .filter((value): value is string => value !== undefined)
      .sort();
    const metadata = {
      schema: "project-publication.v1",
      title: plan.legacy.title.slice(0, 200),
      description: plan.legacy.description,
      tags: tagNames,
      repo_url: plan.legacy.repo_url,
      owner_id: plan.ownerId,
    };
    const snapshot = { metadata, models: [{ model_id: plan.modelId, model_revision_id: plan.revisionId, position: 0 }] };
    const hash = createHash("sha256").update(canonicalJson(snapshot)).digest();
    const publicationId = stableUuid(seed, "publication", plan.legacy.id);
    await client.query(`insert into project_revisions(id,project_id,content_hash,primary_model_id,metadata_snapshot,created_at) values($1,$2,$3,$4,$5,$6)`, [
      publicationId,
      plan.projectId,
      hash,
      plan.modelId,
      metadata,
      plan.legacy.updated_at,
    ]);
    await client.query(`insert into project_revision_models(project_revision_id,project_id,model_id,model_revision_id,position) values($1,$2,$3,$4,0)`, [
      publicationId,
      plan.projectId,
      plan.modelId,
      plan.revisionId,
    ]);
    await client.query(`update projects set published_revision_id=$2 where id=$1`, [plan.projectId, publicationId]);
  }
}

async function reconcileTarget(pool: Pool, expected: { projects: number; ready: number; published: number }): Promise<Report["invariants"]> {
  const row = (
    await pool.query<{ projects: string; models: string; revisions: string; ready: string; published: string; orphan: string; cross_owner: string; invalid_publications: string }>(
      `select
       (select count(*) from projects) projects,(select count(*) from models) models,(select count(*) from model_revisions) revisions,
       (select count(*) from models where active_revision_id is not null) ready,
       (select count(*) from projects where published_revision_id is not null) published,
       (select count(*) from models m left join projects p on p.id=m.project_id where p.id is null) orphan,
       (select count(*) from import_bindings ib join models m on m.id=ib.model_id join projects p on p.id=m.project_id where ib.user_id<>p.owner_id) cross_owner,
       (select count(*) from projects p left join project_revisions pr on pr.id=p.published_revision_id and pr.project_id=p.id where p.published_revision_id is not null and pr.id is null) invalid_publications`,
    )
  ).rows[0]!;
  const countsMatch =
    Number(row.projects) === expected.projects &&
    Number(row.models) === expected.projects &&
    Number(row.revisions) === expected.projects &&
    Number(row.ready) === expected.ready &&
    Number(row.published) === expected.published;
  return {
    unmapped_owners: 0,
    orphan_rows: countsMatch ? Number(row.orphan) : 1,
    cross_owner_rows: Number(row.cross_owner),
    invalid_publications: Number(row.invalid_publications),
    unaccounted_rows: 0,
  };
}

export async function run(options: Options): Promise<Report> {
  const sourceIdentity = new URL(options.sourceUrl);
  const targetIdentity = new URL(options.targetUrl);
  if (`${sourceIdentity.hostname}:${sourceIdentity.port}${sourceIdentity.pathname}` === `${targetIdentity.hostname}:${targetIdentity.port}${targetIdentity.pathname}`)
    throw new Error("source and target databases must differ");
  const dumpSha256 = await sha256File(options.dump);
  const source = new Pool({ connectionString: options.sourceUrl });
  const target = new Pool({ connectionString: options.targetUrl });
  try {
    const schema = await sourceSchema(source);
    await assertEmptyTarget(target);
    const ownerMap = await loadOwnerMap(options.ownerMap);
    const modelColumns = schema.columns.get("models")!;
    const userColumns = schema.columns.get("users")!;
    const users = (
      await source.query<LegacyUser>(
        `select id,username,display_name,avatar_url,status,created_at,updated_at,handle_confirmed,is_staff,reputation_score,trust_level,trust_level_manual,role,bio,website_url,contacts,maker_verified,${optionalColumn(userColumns, "is_master", "false")},${optionalColumn(userColumns, "master_profile", "null::jsonb")} from users`,
      )
    ).rows;
    const models = (
      await source.query<LegacyModel>(
        `select id,owner_id,title,source_format,status,craft,bbox,created_at,updated_at,description,votes_up,votes_down,downloads_count,recommended_material_id,repo_url,featured_at,repo_path,forked_from,publish_status,comments_count,makes_count,views_count,price_minor,currency,remixes_count,${optionalColumn(modelColumns, "manufacturing_method", "null::text")},${optionalColumn(modelColumns, "requires_ams", "false")} from models order by id`,
      )
    ).rows;
    const files = (
      await source.query<LegacyFile>(`select id,model_id,role,s3_key,size_bytes,checksum,created_at,original_filename,mime_type from model_files order by model_id,created_at,id`)
    ).rows;
    const tags = (await source.query<{ id: string; name: string; created_at: Date }>(`select id,name,created_at from tags order by id`)).rows;
    const modelTags = (await source.query<{ model_id: string; tag_id: string }>(`select model_id,tag_id from model_tags order by model_id,tag_id`)).rows;
    const imports = (
      await source.query<Record<string, unknown>>(
        `select id,model_id,user_id,source_platform,external_id,original_url,source_license,source_popularity,ownership_status,imported_at,created_at,updated_at from import_bindings order by id`,
      )
    ).rows;
    const usersById = new Map(users.map((user) => [user.id, user]));
    const modelsById = new Set(models.map((model) => model.id));
    const tagsById = new Set(tags.map((tag) => tag.id));
    const unmappedOwners = models.filter((model) => !ownerMap.has(model.owner_id) || !usersById.has(model.owner_id));
    const orphanRows = modelTags.filter((row) => !modelsById.has(row.model_id) || !tagsById.has(row.tag_id)).length + files.filter((file) => !modelsById.has(file.model_id)).length;
    const crossOwnerRows = imports.filter((binding) => {
      const model = models.find((item) => item.id === String(binding.model_id));
      return model !== undefined && model.owner_id !== String(binding.user_id);
    }).length;
    if (unmappedOwners.length > 0 || orphanRows > 0 || crossOwnerRows > 0)
      throw new Error(`blocking source reconciliation issue: unmapped_owners=${unmappedOwners.length}, orphan_rows=${orphanRows}, cross_owner_rows=${crossOwnerRows}`);
    const sourceRoot = objectRoot(options.objectSource, "--object-source");
    const targetRoot = objectRoot(options.objectTarget, "--object-target");
    if (sourceRoot !== null && targetRoot === null && options.apply) throw new Error("--apply with filesystem objects requires --object-target fs:DIR");
    const verifiedById = new Map<string, VerifiedFile>();
    for (const file of files) {
      const verified = await verifyFile(file, sourceRoot);
      if (verified) verifiedById.set(file.id, verified);
    }
    const plans: PlannedModel[] = [];
    let duplicateFiles = 0;
    let unsupportedModels = 0;
    let sourceFormatMismatches = 0;
    let regenerationMarkers = 0;
    let unresolvedForks = 0;
    for (const legacy of models) {
      const modelFiles = files.filter((file) => file.model_id === legacy.id && FILE_ROLES.has(file.role));
      const seenSingular = new Set<string>();
      const verifiedFiles: VerifiedFile[] = [];
      for (const file of modelFiles) {
        if (SINGULAR_ROLES.has(file.role) && seenSingular.has(file.role)) {
          duplicateFiles += 1;
          continue;
        }
        if (SINGULAR_ROLES.has(file.role)) seenSingular.add(file.role);
        const verified = verifiedById.get(file.id);
        if (verified) verifiedFiles.push(verified);
      }
      const verifiedSource = verifiedFiles.find((file) => file.role === "source") ?? null;
      const sourceFile = verifiedSource !== null && sourceFilenameMatches(verifiedSource, legacy.source_format) ? verifiedSource : null;
      if (verifiedSource !== null && sourceFile === null) sourceFormatMismatches += 1;
      const supported = SOURCE_FORMATS.has(legacy.source_format) && CRAFTS.has(legacy.craft);
      if (!supported) unsupportedModels += 1;
      const quarantineReason = supported
        ? sourceFile === null
          ? "Legacy source object is missing or failed size/checksum validation"
          : null
        : "Legacy format or craft is unsupported";
      const revisionStatus = quarantineReason !== null ? "failed" : legacy.status === "ready" ? "ready" : "uploaded";
      const regenerationRoles = ["preview", "thumbnail"].filter((role) => !verifiedFiles.some((file) => file.role === role));
      regenerationMarkers += regenerationRoles.length;
      if (legacy.forked_from !== null && !modelsById.has(legacy.forked_from)) unresolvedForks += 1;
      plans.push({
        legacy,
        projectId: stableUuid(dumpSha256, "project", legacy.id),
        modelId: stableUuid(dumpSha256, "model", legacy.id),
        revisionId: stableUuid(dumpSha256, "revision", legacy.id),
        ownerId: ownerMap.get(legacy.owner_id)!,
        revisionStatus,
        verifiedFiles: quarantineReason === null ? verifiedFiles : [],
        source: quarantineReason === null ? sourceFile : null,
        regenerationRoles,
        quarantineReason,
      });
    }
    const relation = await relationAccounting(source);
    const excludedCredentialRows = await countExistingTables(source, [
      "api_keys",
      "user_api_keys",
      "sessions",
      "otp_codes",
      "device_enroll_codes",
      "import_connections",
      "billing_provider_webhooks",
      "admin_password_credentials",
    ]);
    const ready = plans.filter((plan) => plan.revisionStatus === "ready").length;
    const published = plans.filter((plan) => plan.revisionStatus === "ready" && plan.legacy.publish_status === "published").length;
    let invariants: Report["invariants"] = { unmapped_owners: 0, orphan_rows: 0, cross_owner_rows: 0, invalid_publications: 0, unaccounted_rows: relation.unaccounted };
    if (options.apply) {
      const client = await target.connect();
      try {
        await client.query("begin");
        await client.query("set constraints all deferred");
        await insertPlan(client, dumpSha256, users, plans, tags, modelTags, imports, ownerMap, targetRoot);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      invariants = await reconcileTarget(target, { projects: plans.length, ready, published });
      invariants.unaccounted_rows = relation.unaccounted;
    }
    const report: Report = {
      contract_version: "legacy-project-import.v1",
      mode: options.apply ? "apply" : "dry-run",
      source: { dump_file: basename(options.dump), dump_sha256: dumpSha256, schema_profile: schema.profile, schema_fingerprint: schema.fingerprint },
      target: { baseline_version: "20260810150000", was_empty: true },
      counts: {
        source_models: models.length,
        mapped_projects: plans.length,
        ready_revisions: ready,
        quarantined_revisions: plans.filter((plan) => plan.revisionStatus === "failed").length,
        published_projects: published,
        verified_files: plans.reduce((sum, plan) => sum + plan.verifiedFiles.length, 0),
        source_files: files.length,
        imported_tags: new Set(modelTags.map((row) => row.tag_id)).size,
        imported_bindings: imports.length,
        derivative_regeneration_markers: regenerationMarkers,
        excluded_credential_rows: excludedCredentialRows,
        excluded_ephemeral_rows: Object.values(relation.accounting)
          .filter((item) => item.disposition === "excluded_ephemeral")
          .reduce((sum, item) => sum + item.rows, 0),
        excluded_deferred_rows: Object.values(relation.accounting)
          .filter((item) => item.disposition === "excluded_deferred")
          .reduce((sum, item) => sum + item.rows, 0),
      },
      relation_accounting: relation.accounting,
      invariants,
      warnings: {
        unsupported_models: unsupportedModels,
        source_format_mismatches: sourceFormatMismatches,
        duplicate_singular_files: duplicateFiles,
        unresolved_forks_cleared: unresolvedForks,
        recommended_material_links_cleared: models.filter((model) => model.recommended_material_id !== null).length,
        objects_unavailable_or_invalid: files.length - verifiedById.size,
      },
      mapping_digest: createHash("sha256")
        .update(canonicalJson(plans.map((plan) => [plan.legacy.id, plan.projectId, plan.modelId, plan.revisionId])))
        .digest("hex"),
      accepted: Object.values(invariants).every((value) => value === 0),
    };
    await mkdir(resolve(options.report, ".."), { recursive: true });
    await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(
      `${report.mode}: ${report.counts.mapped_projects} Projects, ${report.counts.ready_revisions} ready, ${report.counts.quarantined_revisions} quarantined, ${report.counts.published_projects} published; report=${options.report}\n`,
    );
    if (!report.accepted) throw new Error("reconciliation report rejected the target");
    return report;
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`legacy project import failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
