import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { stringify } from "yaml";
import { absoluteRepoPath } from "../src/git/paths.ts";
import { commitFile, initBareRepo, log, readFileContent } from "../src/git/repo.ts";
import { computeConfigurationDigest, computeManifestDigest, type ManifestConfiguration, type ResolvedProjectGraph } from "@portal/contracts/http/models";

// MF-1986 (project-slice-request.v1) live-проверка: Front honestly блокирует cloud slice для
// pinned artifact на frontend-only slug/фикстуре (`so-arm100`, `SOARM_MANIFEST`) — на dev-БД до
// сих пор не было ни одной РЕАЛЬНОЙ модели с git-backed project-code.v1 манифестом. Этот сид
// заводит ОДНУ такую модель — тот же принцип "dev-only, безопасный гейт", что весь seed-dev.ts
// (assertSafeDevSeed вызывается вызывающей стороной, `seed-dev.ts::run()`, до этой функции).
//
// Артефакт — РЕАЛЬНЫЙ SO-ARM100 gauge STL из пиненного upstream-коммита
// `TheRobotStudio/SO-ARM100` (Apache-2.0), тот же источник/коммит/sha256, что
// `apps/mesh/tests/so101_corpus.py::FILES["gauge_loose"]` (держать в синхроне при апдейте канона
// вручную — общего модуля между Python/TS шва нет). Сеть недоступна/хэш разошёлся → сид падает
// (`So101FixtureUnavailable`), НЕ подставляет плейсхолдер — production slice path читает только
// server-owned git/staged S3, врать себе на dev-БД смысла нет.

/** Фиксированный dev-only id — модель не пересоздаётся, только обновляется при повторном прогоне. */
export const SOARM100_DEV_MODEL_ID = "5b1641eb-8735-4a92-9d77-9db60bdcc80a";
export const SOARM100_CONFIGURATION_ID = "follower-only";
export const SOARM100_WORKFLOW_STEP_ID = "print-follower";
export const SOARM100_ARTIFACT_ID = "follower-print";
export const SOARM100_ARTIFACT_PATH = "print/SO-ARM100/Gauge_0.STL";
const SOARM100_CHILD_MODEL_ID = "a257eb01-796b-54cd-b0a0-01b84a486d84";
const SOARM100_MODEL_REVISION_ID = "e97c4893-83dc-5f02-b055-845c8a90bee7";
const SOARM100_SOURCE_BLOB_ID = "72b1f493-f902-5b01-a546-1fc652900849";
const SOARM100_SOURCE_FILE_ID = "8cf4f72e-f8b7-56d6-8aa1-03f1f0c025fc";
const SOARM100_PUBLICATION_ID = "9d65b5be-e250-5fa5-9c80-370db4d3bce4";

// Канон — буквально apps/mesh/tests/so101_corpus.py::FILES["gauge_loose"] + COMMIT_SHA/REPO.
const UPSTREAM_REPO = "TheRobotStudio/SO-ARM100";
const UPSTREAM_COMMIT = "fda892cba81032c46c40976a48c9ceadbf40a9ca";
const UPSTREAM_PATH = "STL/Gauges/Gauge_0.STL";
const UPSTREAM_SHA256 = "ba5b60f80ac9a47b1ba92c8c7d28e3128717e9497f6cc289f8d1e31a0243eb41";
const UPSTREAM_URL = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_COMMIT}/${UPSTREAM_PATH}`;
const FETCH_TIMEOUT_MS = 30_000;

const SEED_AUTHOR = { name: "3mf.tech dev seed", email: "seed@users.3mf.tech" };

export class So101FixtureUnavailable extends Error {}

/** Сеть недоступна или апстрим разошёлся с пиненным хэшем → бросает, вызывающий сид падает
 * целиком (fail closed) — тот же контракт, что so101_corpus.py::fetch, просто без pytest.skip
 * (сиду скипать нечего, это не тест, а обязательный шаг перед commit реальных байт). */
async function fetchPinnedGaugeStl(): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(UPSTREAM_URL, { signal: controller.signal });
  } catch (err) {
    throw new So101FixtureUnavailable(`не удалось скачать ${UPSTREAM_URL}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new So101FixtureUnavailable(`${UPSTREAM_URL} вернул HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== UPSTREAM_SHA256) {
    throw new So101FixtureUnavailable(
      `${UPSTREAM_PATH}@${UPSTREAM_COMMIT.slice(0, 12)}: sha256 разошёлся — ожидали ${UPSTREAM_SHA256}, ` +
        `получили ${actualSha256} (апстрим изменил файл на пиненном коммите? не должно случиться, сеть не доверяем молча)`,
    );
  }
  return bytes;
}

const STL_BINARY_HEADER_SIZE = 80;
const STL_BINARY_COUNT_SIZE = 4;
const STL_BINARY_TRIANGLE_SIZE = 50;

/** Тот же binary-vs-ascii sniff, что `apps/mesh/src/mesh/stl_reader.py::sniff_stl` (алгоритм, не
 * код — портирован на TS для этого сида): решает по совпадению размера с формулой
 * `80 + 4 + count*50`, не по текстовому маркеру `solid` (некоторые писатели кладут его и в
 * бинарный STL). Возвращает грубый bbox в мм — только для preflight footprint approximation
 * этого dev-сида, не заменяет реальный geometry-пайплайн Mesh. */
function stlBoundingBoxMm(bytes: Buffer): { x: number; y: number; z: number } | null {
  let isBinary = false;
  let declaredCount: number | null = null;
  if (bytes.length >= STL_BINARY_HEADER_SIZE + STL_BINARY_COUNT_SIZE) {
    declaredCount = bytes.readUInt32LE(STL_BINARY_HEADER_SIZE);
    const expectedSize = STL_BINARY_HEADER_SIZE + STL_BINARY_COUNT_SIZE + declaredCount * STL_BINARY_TRIANGLE_SIZE;
    isBinary = expectedSize === bytes.length;
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let sawVertex = false;
  const accumulate = (x: number, y: number, z: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    sawVertex = true;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };

  if (isBinary && declaredCount !== null) {
    let offset = STL_BINARY_HEADER_SIZE + STL_BINARY_COUNT_SIZE;
    for (let i = 0; i < declaredCount; i++) {
      const vertexBase = offset + 12; // skip 3-float facet normal
      for (let v = 0; v < 3; v++) {
        const base = vertexBase + v * 12;
        accumulate(bytes.readFloatLE(base), bytes.readFloatLE(base + 4), bytes.readFloatLE(base + 8));
      }
      offset += STL_BINARY_TRIANGLE_SIZE;
    }
  } else {
    const text = bytes.toString("ascii");
    const vertexPattern = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let match: RegExpExecArray | null;
    while ((match = vertexPattern.exec(text)) !== null) {
      accumulate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
  }

  if (!sawVertex) return null;
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}

function buildManifest(artifactSha256Hex: string): ResolvedProjectGraph {
  return {
    schema: "https://schemas.3mf.tech/project/v1",
    project: {
      uid: "soarm100-dev-fixture",
      title: "SO-ARM100 Follower Gauge (dev fixture, pinned upstream)",
      "default-configuration": SOARM100_CONFIGURATION_ID,
      units: { length: "mm", coordinates: "right-handed-z-up" },
      upstream: { url: `https://github.com/${UPSTREAM_REPO}`, ref: null, commit: UPSTREAM_COMMIT },
      license: { spdx: "Apache-2.0" },
    },
    artifacts: {
      [SOARM100_ARTIFACT_ID]: { path: SOARM100_ARTIFACT_PATH, kind: "print-model", sha256: artifactSha256Hex },
    },
    components: {
      "follower-gauge": { kind: "manufactured", artifact: SOARM100_ARTIFACT_ID },
    },
    configurations: {
      [SOARM100_CONFIGURATION_ID]: {
        title: "Follower gauge only",
        artifacts: [SOARM100_ARTIFACT_ID],
        components: ["follower-gauge"],
        workflow: "print-only",
      },
    },
    workflows: {
      "print-only": {
        phases: { print: { type: "print", steps: [SOARM100_WORKFLOW_STEP_ID] } },
        steps: { [SOARM100_WORKFLOW_STEP_ID]: { title: "Напечатайте gauge" } },
      },
    },
  };
}

export interface Soarm100DevFixture {
  modelId: string;
  ownerId: string;
  revision: string;
  configurationId: string;
  workflowStepId: string;
  artifactId: string;
  artifactSha256: string;
  /** sha256 канонического JSON резолвленного графа — computeManifestDigest, project.manifest.md §6. */
  manifestDigest: string;
  /** sha256 канонического JSON default-configuration — computeConfigurationDigest, §6. */
  configurationDigest: string;
}

/** Ищет уже закоммиченный HEAD с УЖЕ ВЕРИФИЦИРОВАННЫМ (тем же пиненным sha256) артефактом —
 * не просто "репо существует". Стейл-плейсхолдер от прошлой версии сида (или повреждённая
 * запись) не проходит эту проверку и получает свежий commit ниже, а не тихо остаётся навсегда. */
async function existingVerifiedRevision(repoPath: string): Promise<string | null> {
  const manifestBytes = await readFileContent(repoPath, "portal.project.yaml", "main").catch(() => null);
  if (!manifestBytes) return null;
  const entries = await log(repoPath, "main", 1);
  const headSha = entries[0]?.sha;
  if (!headSha) return null;
  const artifactBytes = await readFileContent(repoPath, SOARM100_ARTIFACT_PATH, headSha).catch(() => null);
  if (!artifactBytes) return null;
  const actualSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  return actualSha256 === UPSTREAM_SHA256 ? headSha : null;
}

/**
 * Идемпотентно заводит одну публичную ready-модель с настоящим git-backed project-code.v1
 * манифестом + реальным пиненным SO-ARM100 gauge артефактом — то, чего не хватало для
 * live-проверки `POST /models/:id/slice` с `layout`/`source` (см. header-комментарий). Повторный
 * прогон с уже верифицированным артефактом не бьёт сеть заново и не пересоздаёт commit.
 */
export async function upsertDevSoarm100Project(db: Pool, ownerId: string): Promise<Soarm100DevFixture> {
  const modelId = SOARM100_DEV_MODEL_ID;
  const repoPath = absoluteRepoPath(modelId);

  const existing = await db.query<{ repo_path: string | null }>(`select repo_path from projects where id = $1`, [modelId]);
  let revision = existing.rows[0]?.repo_path ? await existingVerifiedRevision(repoPath) : null;
  let stlBytes: Buffer | null = null;

  if (!revision) {
    stlBytes = await fetchPinnedGaugeStl();
    const manifest = buildManifest(createHash("sha256").update(stlBytes).digest("hex"));

    await initBareRepo(repoPath);
    await commitFile(repoPath, {
      filePath: "portal.project.yaml",
      content: Buffer.from(stringify(manifest), "utf8"),
      message: "seed: SO-ARM100 dev gauge fixture manifest (MF-1986)",
      author: SEED_AUTHOR,
    });
    revision = await commitFile(repoPath, {
      filePath: SOARM100_ARTIFACT_PATH,
      content: stlBytes,
      message: `seed: SO-ARM100 gauge artifact, pinned ${UPSTREAM_REPO}@${UPSTREAM_COMMIT.slice(0, 12)} (MF-1986)`,
      author: SEED_AUTHOR,
    });
  } else {
    stlBytes = await readFileContent(repoPath, SOARM100_ARTIFACT_PATH, revision);
    if (!stlBytes) throw new So101FixtureUnavailable(`${SOARM100_ARTIFACT_PATH}@${revision}: артефакт пропал между проверкой и чтением`);
  }

  const artifactSha256 = createHash("sha256").update(stlBytes).digest("hex");
  const manifest = buildManifest(artifactSha256);
  const manifestDigest = computeManifestDigest(manifest);
  const configuration = manifest.configurations![SOARM100_CONFIGURATION_ID] as ManifestConfiguration;
  const configurationDigest = computeConfigurationDigest(configuration);

  const bbox = stlBoundingBoxMm(stlBytes);
  if (!bbox) {
    // Не должно случиться на верифицированном (sha256-сверенном) реальном STL — если случилось,
    // это баг парсера этого сида, не повод фабриковать габариты; preflight честно получит
    // unsupported_geometry (models.bbox = null), не тихую неправду.
    console.warn(`  SO-ARM100 seed: не удалось распознать bbox ${SOARM100_ARTIFACT_PATH} — model_revisions.bbox останется null`);
  }

  const title = "SO-ARM100 Follower Gauge (dev fixture, pinned upstream)";
  const description =
    `Dev-фикстура project-slice-request.v1 (MF-1986): реальный git-backed project-code.v1 ` +
    `манифест + пиненный SO-ARM100 gauge STL (${UPSTREAM_REPO}@${UPSTREAM_COMMIT.slice(0, 12)}, ` +
    `Apache-2.0) для live-проверки pinned artifact + layout слайсинга.`;
  const sourceChecksum = createHash("sha256").update(stlBytes).digest();
  const metadata = { schema: "project-publication.v1", title, description, tags: [] as string[], repo_url: null, owner_id: ownerId };
  const snapshot = { metadata, models: [{ model_id: SOARM100_CHILD_MODEL_ID, model_revision_id: SOARM100_MODEL_REVISION_ID, position: 0 }] };
  const publicationHash = createHash("sha256").update(JSON.stringify(snapshot)).digest();
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into projects (id, owner_id, title, description, repo_path)
       values ($1::uuid, $2, $3, $4, $1::text)
       on conflict (id) do update set
         owner_id = excluded.owner_id, title = excluded.title, description = excluded.description,
         repo_path = excluded.repo_path, deleted_at = null, updated_at = now()`,
      [modelId, ownerId, title, description],
    );
    await client.query(
      `insert into models (id, project_id, name, position, latest_revision_id, active_revision_id)
       values ($1, $2, $3, 0, $4, $4)
       on conflict (id) do update set
         project_id = excluded.project_id, name = excluded.name, position = 0,
         latest_revision_id = excluded.latest_revision_id, active_revision_id = excluded.active_revision_id,
         deleted_at = null, updated_at = now()`,
      [SOARM100_CHILD_MODEL_ID, modelId, title.slice(0, 120), SOARM100_MODEL_REVISION_ID],
    );
    await client.query(
      `insert into model_revisions
         (id, model_id, source_format, bbox, status, craft, source_checksum, source_size_bytes, ready_at)
       values ($1, $2, 'stl', $3::jsonb, 'ready', '3d_printing', $4, $5, now())
       on conflict (id) do update set
         model_id = excluded.model_id, source_format = 'stl', bbox = excluded.bbox, status = 'ready',
         source_checksum = excluded.source_checksum, source_size_bytes = excluded.source_size_bytes,
         failure_code = null, failure_detail_safe = null, failed_at = null,
         processing_started_at = null, ready_at = now()`,
      [SOARM100_MODEL_REVISION_ID, SOARM100_CHILD_MODEL_ID, bbox ? JSON.stringify(bbox) : null, sourceChecksum, stlBytes.length],
    );
    const sourceKey = `protected/models/${modelId}/source.stl`;
    const blob = await client.query<{ id: string }>(
      `insert into storage_blobs (id, owner_id, checksum, size_bytes, s3_key, state)
       values ($1, $2, $3, $4, $5, 'ready')
       on conflict (owner_id, checksum, size_bytes) do update set state = 'ready', updated_at = now()
       returning id`,
      [SOARM100_SOURCE_BLOB_ID, ownerId, sourceChecksum, stlBytes.length, sourceKey],
    );
    await client.query(
      `insert into model_revision_files
         (id, model_revision_id, role, size_bytes, checksum, original_filename, mime_type, blob_id, is_source)
       values ($1, $2, 'source', $3, $4, $5, 'model/stl', $6, true)
       on conflict (id) do update set
         model_revision_id = excluded.model_revision_id, size_bytes = excluded.size_bytes,
         checksum = excluded.checksum, original_filename = excluded.original_filename,
         mime_type = excluded.mime_type, blob_id = excluded.blob_id, is_source = true`,
      [SOARM100_SOURCE_FILE_ID, SOARM100_MODEL_REVISION_ID, stlBytes.length, sourceChecksum, "Gauge_0.STL", blob.rows[0]!.id],
    );
    await client.query(
      `insert into project_revisions (id, project_id, content_hash, primary_model_id, metadata_snapshot)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, content_hash) do nothing`,
      [SOARM100_PUBLICATION_ID, modelId, publicationHash, SOARM100_CHILD_MODEL_ID, metadata],
    );
    await client.query(
      `insert into project_revision_models (project_revision_id, project_id, model_id, model_revision_id, position)
       values ($1, $2, $3, $4, 0) on conflict (project_revision_id, model_id) do nothing`,
      [SOARM100_PUBLICATION_ID, modelId, SOARM100_CHILD_MODEL_ID, SOARM100_MODEL_REVISION_ID],
    );
    await client.query(`update projects set primary_model_id = $2, published_revision_id = $3, updated_at = now() where id = $1`, [
      modelId,
      SOARM100_CHILD_MODEL_ID,
      SOARM100_PUBLICATION_ID,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return {
    modelId,
    ownerId,
    revision,
    configurationId: SOARM100_CONFIGURATION_ID,
    workflowStepId: SOARM100_WORKFLOW_STEP_ID,
    artifactId: SOARM100_ARTIFACT_ID,
    artifactSha256,
    manifestDigest,
    configurationDigest,
  };
}
