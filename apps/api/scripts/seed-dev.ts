// Идемпотентный сид dev-среды (MF-535, эпик MF-532 «временная dev-среда на VDS»).
//
// Слой 1 (синтетический базис приёмки среды): dev-юзеры + ~20 моделей status='ready' разных
// форматов, у каждой preview.glb (6 GLB-примитивов из scripts/fixtures/*.glb) и role='thumbnail'
// webp — каталог/hero не пустые, карточки без «дырок» (требования Design, «Итоги совета»). ~5
// моделей помечены featured — hero-карусель наполнена.
//
// Слой 2 (hero-копия реальных прод-моделей) НЕ входит в этот скрипт: дешёвая проверка прод-пула
// (08.07) дала 3 ready-модели с preview на проде < порога 6 → fast-path hero снят с критического
// пути, PM триггерит fallback по MF-531 (см. коммент к карточке). Ассеты слоя 2 — read-only копия
// прод-MinIO — заводятся отдельным прогоном/скриптом на стенде, когда пул дорастёт (Stage 2).
//
// БЕЗОПАСНОСТЬ ПО УМОЛЧАНИЮ (двойной предохранитель, чтобы никогда не тронуть прод):
//   • падает при NODE_ENV=production;
//   • падает, если имя БД ≠ portal_dev (переопределяемо SEED_DB_NAME для нестандартного стенда).
// Прод живёт в БД `portal` (CLAUDE.md) — этот гейт его физически отсекает.
//
// Идемпотентность: все вставки — upsert по детерминированным UUID (uuidv5). Повторный прогон
// досеивает/обновляет, ручной хирургии не требует. Объекты в бакете перезаписываются PutObject.
//
// Запуск: pnpm --filter @portal/api seed:dev
//   env: DATABASE_URL (обяз.), S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY (обяз. для ассетов),
//        S3_BUCKET_MODELS (на dev = 3mf-dev), опц. SEED_DB_NAME, флаги --no-migrate / --skip-assets.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { PoolClient } from "pg";

import { pool } from "../src/db/client.ts";
import { modelObjectKey } from "../src/storage/s3.ts";
import { assertSafeDevSeed } from "./dev-seed-guard.ts";
import { runDevMigrations } from "./seed-dev-migrations.ts";
import { upsertDevPrinters } from "./seed-dev-printers.ts";
import { upsertDevLivePrinterFixtures } from "./seed-dev-live-printers.ts";
import { upsertDevSoarm100Project } from "./seed-dev-soarm100.ts";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const args = new Set(process.argv.slice(2));
const RUN_MIGRATE = !args.has("--no-migrate");
const SEED_ASSETS = !args.has("--skip-assets");

// ── Детерминированный UUID v5 (стабильные id между прогонами → idempotent upsert) ─────
const SEED_NAMESPACE = "6f9b2c14-3a7d-5e42-9c11-8d0f7a2b4e63"; // фиксированный namespace сида
function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}
function bytesToUuid(b: Buffer): string {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
function uuidv5(name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.concat([uuidToBytes(SEED_NAMESPACE), Buffer.from(name, "utf8")]))
    .digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50; // версия 5
  b[8] = (b[8]! & 0x3f) | 0x80; // вариант RFC 4122
  return bytesToUuid(b);
}

// ── Данные сида ──────────────────────────────────────────────────────────────────────
interface SeedUser {
  username: string;
  display: string;
  bio?: string;
  websiteUrl?: string;
  contacts?: { label: string; url: string }[];
}
// bio/websiteUrl/contacts (MF-357, Фаза 1 эпика MF-15) — только на части юзеров, не на
// devuser: приёмка должна видеть и заполненный, и пустой профиль в каталоге/на своей странице.
const USERS: SeedUser[] = [
  { username: "devuser", display: "Dev User" }, // dev-админ (ADMIN_USERNAMES=devuser)
  {
    username: "makerkate",
    display: "Kate Maker",
    bio: "Печатаю фигурки и декор, люблю ремиксить чужие модели.",
    websiteUrl: "https://makerkate.example.com",
    contacts: [{ label: "Telegram", url: "https://t.me/makerkate" }],
  },
  {
    username: "viktorcad",
    display: "Viktor CAD",
    bio: "Инженер-конструктор, функциональные детали и механизмы.",
    contacts: [
      { label: "Telegram", url: "https://t.me/viktorcad" },
      { label: "GitVerse", url: "https://gitverse.ru/viktorcad" },
    ],
  },
  { username: "printfarm", display: "PrintFarm RU" },
];

const FIXTURE_SLUGS = ["cube", "pyramid", "cylinder", "cone", "sphere", "torus"] as const;
type FormatT = "stl" | "3mf" | "step" | "obj";

interface SeedModel {
  title: string;
  format: FormatT;
  owner: number; // индекс в USERS
  tags: string[];
  up: number;
  down: number;
  downloads: number;
  featured?: boolean;
}

// ~20 моделей: разные форматы/авторы/теги, ~5 featured. up/down/downloads — правдоподобная
// денормализация для сортировок «новые»/«популярные» (счётчики каталога живут на models).
const MODELS: SeedModel[] = [
  { title: "Articulated Dragon", format: "3mf", owner: 1, tags: ["articulated", "toy", "fantasy"], up: 214, down: 6, downloads: 1890, featured: true },
  { title: "Benchy Remix — Low Poly", format: "stl", owner: 2, tags: ["calibration", "boat"], up: 132, down: 9, downloads: 3400, featured: true },
  { title: "Modular Desk Organizer", format: "3mf", owner: 3, tags: ["organizer", "office", "modular"], up: 98, down: 3, downloads: 760, featured: true },
  { title: "Planetary Gearbox Demo", format: "step", owner: 2, tags: ["mechanical", "gears", "functional"], up: 176, down: 4, downloads: 540, featured: true },
  { title: "Voronoi Vase Set", format: "stl", owner: 1, tags: ["vase", "decor", "voronoi"], up: 145, down: 8, downloads: 1120, featured: true },
  { title: "Raspberry Pi 5 Case", format: "step", owner: 3, tags: ["case", "electronics", "functional"], up: 87, down: 2, downloads: 980 },
  { title: "Hex Wall Panel", format: "3mf", owner: 1, tags: ["decor", "wall", "modular"], up: 64, down: 5, downloads: 410 },
  { title: "Cable Clip Multipack", format: "stl", owner: 3, tags: ["organizer", "office"], up: 51, down: 1, downloads: 2200 },
  { title: "Miniature Castle Keep", format: "obj", owner: 2, tags: ["terrain", "tabletop", "fantasy"], up: 119, down: 7, downloads: 690 },
  { title: "Ergonomic Pen Holder", format: "stl", owner: 1, tags: ["office", "organizer"], up: 39, down: 2, downloads: 320 },
  { title: "Flexible Phone Stand", format: "3mf", owner: 2, tags: ["stand", "gadget", "functional"], up: 73, down: 4, downloads: 1450 },
  { title: "Topographic Coaster", format: "stl", owner: 3, tags: ["decor", "coaster", "map"], up: 58, down: 3, downloads: 520 },
  { title: "Snap-Fit Storage Box", format: "step", owner: 1, tags: ["box", "storage", "functional"], up: 92, down: 6, downloads: 830 },
  { title: "Gyroscopic Fidget", format: "stl", owner: 2, tags: ["toy", "fidget", "articulated"], up: 141, down: 11, downloads: 2600 },
  { title: "Herb Garden Marker Kit", format: "obj", owner: 3, tags: ["garden", "kit"], up: 44, down: 1, downloads: 380 },
  { title: "Parametric Bracket", format: "step", owner: 1, tags: ["mechanical", "bracket", "functional"], up: 67, down: 2, downloads: 610 },
  { title: "Lithophane Night Lamp", format: "3mf", owner: 2, tags: ["decor", "lamp", "lithophane"], up: 108, down: 5, downloads: 1330 },
  { title: "Desk Cable Tray", format: "stl", owner: 3, tags: ["office", "organizer", "cable"], up: 55, down: 3, downloads: 940 },
  { title: "Tabletop Dice Tower", format: "obj", owner: 1, tags: ["tabletop", "dice", "toy"], up: 83, down: 4, downloads: 720 },
  { title: "Wall Mount Headphone Hook", format: "stl", owner: 2, tags: ["wall", "mount", "functional"], up: 49, down: 2, downloads: 1010 },
];

const FORMAT_EXT: Record<FormatT, string> = { stl: "stl", "3mf": "3mf", step: "step", obj: "obj" };
// Правдоподобный вес source-файла для таблицы характеристик (detail.ts читает size_bytes source).
const FORMAT_SIZE: Record<FormatT, number> = { stl: 4_800_000, "3mf": 2_600_000, step: 1_400_000, obj: 6_200_000 };

// ── S3 (dev-бакет) ───────────────────────────────────────────────────────────────────
function modelsBucket(): string {
  return process.env.S3_BUCKET_MODELS ?? "3mf"; // на dev = 3mf-dev (env-контракт эпика)
}
function s3Client(): S3Client | null {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: process.env.S3_REGION ?? "ru-central-1",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    // Нет бакета (на локалке MinIO / первый прогон) — заводим. На dev его создаёт Ops;
    // CreateBucket идемпотентен по смыслу (already-owned → ловим и продолжаем).
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`  bucket '${bucket}' создан`);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw err;
    }
  }
}

// ── Основной прогон ──────────────────────────────────────────────────────────────────
async function upsertUsers(): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  for (const [i, u] of USERS.entries()) {
    // ON CONFLICT (username), не (id): /auth/dev (MF-534) может успеть создать 'devuser' первым
    // со своим gen_random_uuid() — детерминированный uuidv5 тогда конфликтует по username, не по
    // id. Берём реальный id строки (returning), не навязываем свой.
    const id = uuidv5(`user:${u.username}`);
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (id, username, display_name, bio, website_url, contacts, status, handle_confirmed)
       values ($1, $2, $3, $4, $5, $6, 'active', true)
       on conflict (username) do update set
         display_name = excluded.display_name, bio = excluded.bio, website_url = excluded.website_url,
         contacts = excluded.contacts, updated_at = now()
       returning id`,
      [id, u.username, u.display, u.bio ?? null, u.websiteUrl ?? null, JSON.stringify(u.contacts ?? [])],
    );
    ids.set(i, rows[0]!.id);
  }
  return ids;
}

async function upsertTags(names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const name of names) {
    const { rows } = await pool.query<{ id: string }>(`insert into tags (name) values ($1) on conflict (name) do update set name = excluded.name returning id`, [name]);
    map.set(name, rows[0]!.id);
  }
  return map;
}

async function upsertModelFile(
  client: PoolClient,
  s3: S3Client | null,
  ownerId: string,
  projectId: string,
  revisionId: string,
  role: "source" | "preview" | "thumbnail",
  key: string,
  body: Buffer,
  contentType: string,
  upload: boolean,
  sizeBytes = body.length,
): Promise<void> {
  const fileId = uuidv5(`file:${projectId}:${role}`);
  const blobId = uuidv5(`blob:${projectId}:${role}`);
  const checksum = createHash("sha256").update(body).digest();
  const blob = await client.query<{ id: string; s3_key: string }>(
    `insert into storage_blobs (id, owner_id, checksum, size_bytes, s3_key, state)
     values ($1, $2, $3, $4, $5, 'ready')
     on conflict (owner_id, checksum, size_bytes) do update set state = 'ready', updated_at = now()
     returning id, s3_key`,
    [blobId, ownerId, checksum, sizeBytes, key],
  );
  await client.query(
    `insert into model_revision_files
       (id, model_revision_id, role, size_bytes, checksum, original_filename, mime_type, blob_id, is_source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do update set
       model_revision_id = excluded.model_revision_id, role = excluded.role,
       size_bytes = excluded.size_bytes, checksum = excluded.checksum,
       original_filename = excluded.original_filename, mime_type = excluded.mime_type,
       blob_id = excluded.blob_id, is_source = excluded.is_source`,
    [fileId, revisionId, role, sizeBytes, checksum, key.split("/").at(-1), contentType, blob.rows[0]!.id, role === "source"],
  );
  if (upload && s3) {
    await s3.send(new PutObjectCommand({ Bucket: modelsBucket(), Key: blob.rows[0]!.s3_key, Body: body, ContentType: contentType }));
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function upsertPublishedProject(
  client: PoolClient,
  input: SeedModel & {
    projectId: string;
    ownerId: string;
    source: Buffer;
    preview: Buffer;
    thumbnail: Buffer;
    sourceKey: string;
    featuredAt: Date | null;
    tagIds: ReadonlyMap<string, string>;
  },
  s3: S3Client | null,
): Promise<void> {
  const childModelId = uuidv5(`child-model:${input.projectId}`);
  const revisionId = uuidv5(`model-revision:${input.projectId}`);
  const sourceChecksum = createHash("sha256").update(input.source).digest();
  const description = `Демо-модель dev-среды: ${input.title.toLowerCase()}. Синтетическая фикстура для ревью каталога/hero (MF-535).`;

  await client.query(
    `insert into projects (id, owner_id, title, description, votes_up, votes_down, downloads_count, featured_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (id) do update set
       owner_id = excluded.owner_id, title = excluded.title, description = excluded.description,
       votes_up = excluded.votes_up, votes_down = excluded.votes_down,
       downloads_count = excluded.downloads_count, featured_at = excluded.featured_at,
       deleted_at = null, updated_at = now()`,
    [input.projectId, input.ownerId, input.title, description, input.up, input.down, input.downloads, input.featuredAt],
  );
  await client.query(
    `insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
     values ($1, $2, $3, 0, $4, $4)
     on conflict (id) do update set
       project_id = excluded.project_id, name = excluded.name, position = 0,
       latest_revision_id = excluded.latest_revision_id, active_revision_id = excluded.active_revision_id,
       deleted_at = null, updated_at = now()`,
    [childModelId, input.projectId, input.title.slice(0, 120), revisionId],
  );
  await client.query(
    `insert into model_revisions
       (id, model_id, source_format, status, craft, source_checksum, source_size_bytes, ready_at)
     values ($1, $2, $3, 'ready', '3d_printing', $4, $5, now())
     on conflict (id) do update set
       model_id = excluded.model_id, source_format = excluded.source_format, status = 'ready',
       source_checksum = excluded.source_checksum, source_size_bytes = excluded.source_size_bytes,
       failure_code = null, failure_detail_safe = null, failed_at = null,
       processing_started_at = null, ready_at = now()`,
    [revisionId, childModelId, input.format, sourceChecksum, FORMAT_SIZE[input.format]],
  );

  await upsertModelFile(
    client,
    s3,
    input.ownerId,
    input.projectId,
    revisionId,
    "source",
    input.sourceKey,
    input.source,
    "application/octet-stream",
    false,
    FORMAT_SIZE[input.format],
  );
  await upsertModelFile(
    client,
    s3,
    input.ownerId,
    input.projectId,
    revisionId,
    "preview",
    modelObjectKey(input.projectId, "preview", "glb"),
    input.preview,
    "model/gltf-binary",
    SEED_ASSETS,
  );
  await upsertModelFile(
    client,
    s3,
    input.ownerId,
    input.projectId,
    revisionId,
    "thumbnail",
    modelObjectKey(input.projectId, "thumb", "webp"),
    input.thumbnail,
    "image/webp",
    SEED_ASSETS,
  );

  for (const tag of input.tags) {
    await client.query(`insert into model_tags (model_id, tag_id) values ($1, $2) on conflict (model_id, tag_id) do nothing`, [input.projectId, input.tagIds.get(tag)!]);
  }

  const metadata = { schema: "project-publication.v1", title: input.title, description, tags: [...input.tags].sort(), repo_url: null, owner_id: input.ownerId };
  const snapshot = { metadata, models: [{ model_id: childModelId, model_revision_id: revisionId, position: 0 }] };
  const contentHash = createHash("sha256").update(canonicalJson(snapshot)).digest();
  const publicationId = uuidv5(`project-revision:${input.projectId}:${contentHash.toString("hex")}`);
  await client.query(
    `insert into project_revisions (id, project_id, content_hash, primary_model_id, metadata_snapshot)
     values ($1, $2, $3, $4, $5) on conflict (project_id, content_hash) do nothing`,
    [publicationId, input.projectId, contentHash, childModelId, metadata],
  );
  await client.query(
    `insert into project_revision_models (project_revision_id, project_id, model_id, model_revision_id, position)
     values ($1, $2, $3, $4, 0) on conflict (project_revision_id, model_id) do nothing`,
    [publicationId, input.projectId, childModelId, revisionId],
  );
  await client.query(`update projects set primary_model_id = $2, published_revision_id = $3, updated_at = now() where id = $1`, [input.projectId, childModelId, publicationId]);
}

async function run(): Promise<void> {
  console.log("seed-dev: старт");
  await assertSafeDevSeed(pool);

  if (RUN_MIGRATE) {
    console.log("  migrate() — идемпотентный DDL…");
    await runDevMigrations();
  }

  await upsertDevPrinters(pool);
  // Живой принтер (MF-1952): фикстуры user_printers/agents/device_state под служебным
  // webcheck-аккаунтом autofab-agent — покрывают весь контракт GET /me/printers/:id/live.
  await upsertDevLivePrinterFixtures(pool);

  const s3 = SEED_ASSETS ? s3Client() : null;
  if (SEED_ASSETS) {
    if (!s3) {
      throw new Error(
        "seed-dev: S3 не сконфигурирован (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY) — ассеты обязательны. " + "Задай креды бакета или прогони с --skip-assets (только строки в БД).",
      );
    }
    await ensureBucket(s3, modelsBucket());
  }

  // Читаем фикстуры один раз (6 GLB + 6 webp).
  const glbBySlug = new Map<string, Buffer>();
  const webpBySlug = new Map<string, Buffer>();
  for (const slug of FIXTURE_SLUGS) {
    glbBySlug.set(slug, readFileSync(join(FIXTURES_DIR, `${slug}.glb`)));
    webpBySlug.set(slug, readFileSync(join(FIXTURES_DIR, `${slug}.webp`)));
  }

  const userIds = await upsertUsers();

  // Live-проверка project-slice-request.v1 (MF-1986): единственная модель на dev-БД с реальным
  // git-backed project-code.v1 манифестом — без неё POST /models/:id/slice с layout/source
  // физически некому проверить (GET /models?q=ARM100 до этого возвращал пусто).
  const soarm100 = await upsertDevSoarm100Project(pool, userIds.get(0)!); // 0 — devuser (USERS[0])
  console.log(
    `  SO-ARM100 dev fixture: model_id=${soarm100.modelId} revision=${soarm100.revision} ` +
      `configuration_id=${soarm100.configurationId} configuration_digest=${soarm100.configurationDigest} ` +
      `workflow_step_id=${soarm100.workflowStepId} artifact_id=${soarm100.artifactId} ` +
      `artifact_sha256=${soarm100.artifactSha256} manifest_digest=${soarm100.manifestDigest}`,
  );

  const allTags = [...new Set(MODELS.flatMap((m) => m.tags))];
  const tagIds = await upsertTags(allTags);

  let featuredRank = 0;
  for (const [i, m] of MODELS.entries()) {
    const projectId = uuidv5(`model:${m.title}`);
    const ownerId = userIds.get(m.owner)!;
    const slug = FIXTURE_SLUGS[i % FIXTURE_SLUGS.length]!;
    const ext = FORMAT_EXT[m.format];
    const client = await pool.connect();
    try {
      await client.query("begin");
      await upsertPublishedProject(
        client,
        {
          ...m,
          projectId,
          ownerId,
          source: Buffer.from(`${projectId}:source`),
          preview: glbBySlug.get(slug)!,
          thumbnail: webpBySlug.get(slug)!,
          sourceKey: modelObjectKey(projectId, "source", ext),
          featuredAt: m.featured ? new Date(Date.now() - featuredRank++ * 60_000) : null,
          tagIds,
        },
        s3,
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  // Сводка/самопроверка.
  const counts = await pool.query<{ users: string; models: string; ready: string; featured: string; previews: string; thumbs: string }>(
    `select
       (select count(*) from users) as users,
       (select count(*) from projects) as models,
       (select count(*) from projects where published_revision_id is not null and deleted_at is null) as ready,
       (select count(*) from projects where featured_at is not null and deleted_at is null) as featured,
       (select count(*) from model_revision_files where role='preview') as previews,
       (select count(*) from model_revision_files where role='thumbnail') as thumbs`,
  );
  const c = counts.rows[0]!;
  console.log(
    `seed-dev: готово — users=${c.users}, models=${c.models} (ready=${c.ready}, featured=${c.featured}), ` +
      `preview=${c.previews}, thumbnail=${c.thumbs}, ассеты=${SEED_ASSETS ? `бакет '${modelsBucket()}'` : "пропущены"}`,
  );
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
