import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ExternalFile, ExternalImage, ImportConnector } from "../infrastructure/connector.ts";
import { normalize } from "../infrastructure/normalize.ts";
import { pool } from "../../../db/client.ts";
import {
  addOwnedModelFile,
  childModelIdForOwnedProject,
  createOwnedImportedModel,
  deleteOwnedModelFiles,
  detectAndValidateFormat,
  FormatMismatchError,
  projectIdForOwnedChildModel,
  syncOwnedModelTags,
  UnsupportedFormatError,
  updateOwnedImportedModel,
} from "../../models/public/index.ts";
import { isModelsStorageConfigured, PROTECTED_ROLES, putModelObjectStream } from "../../../storage/s3.ts";
import { PermanentImportItemError } from "../domain/import-errors.ts";

// Сдаётся после MAX_ATTEMPTS транзиентных сбоев подряд (item уходит в failed/retryable=false,
// «докачка» больше не планируется) — без потолка next_retry_at рос бы бесконечно, а джоб
// никогда бы не завершался. Бэкофф: 30с·2^(attempt-1), потолок 30 минут.
const MAX_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 30 * 60_000;

export function backoffDelayMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_CAP_MS);
}

// "Сдаёмся, не ретраим" — источник сказал «не твоя модель»/404, или файл не прошёл проверку
// формата (плохой файл не починится сам по себе на повторной попытке). Коннекторы (Cults3D и
// будущие) бросают это для точек, откуда ретраить бессмысленно; всё остальное — транзиентный
// сбой (429/5xx), уходит в бэкофф.
export type FileDownloader = (url: string) => Promise<Buffer>;

async function defaultDownloader(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`не удалось скачать файл источника: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

interface JobRow {
  id: string;
  user_id: string;
  connection_id: string | null;
  source_platform: string;
  status: string;
}

interface ItemRow {
  id: string;
  job_id: string;
  external_id: string;
  attempt_count: number;
}

// Одна атомарная выборка следующего item джоба: FOR UPDATE SKIP LOCKED — конкурентные вызовы
// runImportJob (ручной ретрай + плановый прогон cron внахлёст) берут РАЗНЫЕ item, а не одну и
// ту же строку дважды. Готов к обработке: свежий 'queued' ИЛИ 'failed'+retryable, чей
// next_retry_at уже наступил (докачка после бэкоффа).
async function claimNextItem(jobId: string): Promise<ItemRow | null> {
  const result = await pool.query<ItemRow>(
    `update import_job_items set status = 'running', updated_at = now()
     where id = (
       select id from import_job_items
       where job_id = $1
         and (status = 'queued' or (status = 'failed' and retryable and next_retry_at <= now()))
       order by created_at
       limit 1
       for update skip locked
     )
     returning id, job_id, external_id, attempt_count`,
    [jobId],
  );
  return result.rows[0] ?? null;
}

interface DraftResult {
  modelId: string;
  bindingId: string;
}

// Дедуп ПО ВСЕЙ системе на import_bindings.unique(source_platform, external_id) (не путать с
// unique(job_id, external_id) — та защищает только повторный прогон ОДНОГО ЖЕ джоба). Два
// джоба/воркера, претендующих на один и тот же (source_platform, external_id) одновременно —
// pg_advisory_xact_lock сериализует их на ключе, транзакционный, снимается сам на commit/rollback.
// source_format — по факту байтов первого файла (detectAndValidateFormat), не угадывается из
// метаданных (см. комментарий normalize.ts/connector.ts, MF-739): без него models.source_format
// (not null) нечем заполнить.
async function upsertDraft(params: {
  ownerId: string;
  connectionId: string | null;
  sourcePlatform: string;
  externalId: string;
  title: string;
  description: string | null;
  sourceFormat: string;
  originalUrl: string;
  sourceLicense: string;
  sourcePopularity: Record<string, number>;
}): Promise<DraftResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${params.sourcePlatform}:${params.externalId}`]);

    const existing = await client.query<{ id: string; model_id: string }>(`select id, model_id from import_bindings where source_platform = $1 and external_id = $2`, [
      params.sourcePlatform,
      params.externalId,
    ]);

    let modelId: string;
    let bindingId: string;
    if (existing.rows[0]) {
      modelId = await projectIdForOwnedChildModel(existing.rows[0].model_id, client);
      bindingId = existing.rows[0].id;
      await updateOwnedImportedModel(client, { modelId, title: params.title, description: params.description, sourceFormat: params.sourceFormat });
      await client.query(
        `update import_bindings set connection_id = $2, original_url = $3, source_license = $4, source_popularity = $5, updated_at = now()
         where id = $1`,
        [bindingId, params.connectionId, params.originalUrl, params.sourceLicense, JSON.stringify(params.sourcePopularity)],
      );
    } else {
      modelId = await createOwnedImportedModel(client, { ownerId: params.ownerId, title: params.title, description: params.description, sourceFormat: params.sourceFormat });
      const childModelId = await childModelIdForOwnedProject(modelId, client);

      const insertedBinding = await client.query<{ id: string }>(
        `insert into import_bindings
           (model_id, connection_id, user_id, source_platform, external_id, original_url, source_license, source_popularity)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [
          childModelId,
          params.connectionId,
          params.ownerId,
          params.sourcePlatform,
          params.externalId,
          params.originalUrl,
          params.sourceLicense,
          JSON.stringify(params.sourcePopularity),
        ],
      );
      bindingId = insertedBinding.rows[0]!.id;
    }

    await client.query("commit");
    return { modelId, bindingId };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// Файлы/картинки — «как есть» в приёмник MF-8 (конвертер 3MF — заглушка, см. миграцию).
// Первый файл — role='source' (тот, что определяет models.source_format), остальные — 'aux';
// первая картинка — 'preview', остальные — 'thumbnail' (значения по model_files_role_check).
// Без S3-кредов в окружении не падаем: метаданные/формат уже определены и сохранены, файлы
// можно дотянуть повторным прогоном джоба, когда сторадж настроят (тот же best-effort приём,
// что giga/scout-воркеры без S3/GIGACHAT_CREDENTIALS). delete-затем-insert — идемпотентность
// повторной обработки того же item (ре-синк не плодит строки model_files).
async function storeAssets(
  modelId: string,
  primary: { buffer: Buffer; file: ExternalFile },
  restFiles: ExternalFile[],
  restBuffers: Buffer[],
  images: { image: ExternalImage; buffer: Buffer }[],
): Promise<void> {
  if (!isModelsStorageConfigured()) return;

  await deleteOwnedModelFiles(modelId, ["source", "aux", "preview", "thumbnail"]);

  let index = 0;
  const put = async (role: string, filename: string, contentType: string, buffer: Buffer) => {
    const ext = filename.includes(".") ? filename.split(".").pop()! : "bin";
    const prefix = PROTECTED_ROLES.has(role) ? "protected" : "public";
    const key = `${prefix}/models/${modelId}/import-${role}-${index}.${ext}`;
    index += 1;
    await putModelObjectStream(key, Readable.from(buffer), contentType);
    await addOwnedModelFile({ modelId, role, s3Key: key, sizeBytes: buffer.length, checksum: createHash("sha256").update(buffer).digest(), originalFilename: filename });
  };

  await put("source", primary.file.filename, "application/octet-stream", primary.buffer);
  for (let i = 0; i < restFiles.length; i += 1) {
    await put("aux", restFiles[i]!.filename, "application/octet-stream", restBuffers[i]!);
  }
  for (let i = 0; i < images.length; i += 1) {
    await put(i === 0 ? "preview" : "thumbnail", `image-${i}.jpg`, "image/jpeg", images[i]!.buffer);
  }
}

// retryable=false для PermanentImportItemError (источник сказал «не твоя модель»/404, или файл
// не прошёл проверку формата — повторы бессмысленны) ИЛИ когда транзиентные попытки исчерпали
// MAX_ATTEMPTS (сдаёмся, не крутим next_retry_at вечно). Иначе retryable=true с очередным окном
// бэкоффа.
async function recordItemFailure(item: ItemRow, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const attemptCount = item.attempt_count + 1;
  const permanent = err instanceof PermanentImportItemError;
  const retryable = !permanent && attemptCount < MAX_ATTEMPTS;
  const nextRetryAt = retryable ? new Date(Date.now() + backoffDelayMs(attemptCount)) : null;

  await pool.query(
    `update import_job_items
     set status = 'failed', retryable = $2, attempt_count = $3, next_retry_at = $4, last_error = $5, updated_at = now()
     where id = $1`,
    [item.id, retryable, attemptCount, nextRetryAt, message],
  );
}

async function processImportItem(job: JobRow, item: ItemRow, connector: ImportConnector, downloader: FileDownloader): Promise<void> {
  try {
    const meta = await connector.resolveMeta(item.external_id);
    const draft = normalize(meta);

    const files = await connector.fetchFiles(item.external_id);
    const primaryFile = files[0];
    if (!primaryFile) throw new PermanentImportItemError("источник не отдал ни одного файла для этой модели");

    const primaryBuffer = await downloader(primaryFile.downloadUrl);
    let sourceFormat: string;
    try {
      sourceFormat = detectAndValidateFormat(primaryFile.filename, primaryBuffer).format;
    } catch (err) {
      if (err instanceof FormatMismatchError || err instanceof UnsupportedFormatError) {
        throw new PermanentImportItemError(`неподдерживаемый или повреждённый файл: ${err.message}`);
      }
      throw err;
    }

    const restFiles = files.slice(1);
    const restBuffers = await Promise.all(restFiles.map((f) => downloader(f.downloadUrl)));
    const externalImages = await connector.fetchImages(item.external_id);
    const images = await Promise.all(externalImages.map(async (image) => ({ image, buffer: await downloader(image.url) })));

    const draftResult = await upsertDraft({
      ownerId: job.user_id,
      connectionId: job.connection_id,
      sourcePlatform: job.source_platform,
      externalId: item.external_id,
      title: draft.title,
      description: draft.description ?? null,
      sourceFormat,
      originalUrl: meta.originalUrl,
      sourceLicense: draft.sourceLicense,
      sourcePopularity: draft.sourcePopularity,
    });

    await syncOwnedModelTags(draftResult.modelId, draft.tags);
    await storeAssets(draftResult.modelId, { buffer: primaryBuffer, file: primaryFile }, restFiles, restBuffers, images);

    await pool.query(
      `update import_job_items
       set status = 'done', retryable = false, last_error = null, binding_id = $2, updated_at = now()
       where id = $1`,
      [item.id, draftResult.bindingId],
    );
  } catch (err) {
    await recordItemFailure(item, err);
  }
}

// done_count/failed_count/status пересчитываются агрегатом по item (тот же денорм-приём, что
// models.votes_up в models/vote.ts), под FOR UPDATE строки job — конкурентные item одного job
// не гонятся друг с другом за обновление счётчиков. failed_count считает только ОКОНЧАТЕЛЬНО
// упавшие (retryable=false) — item, ждущий следующего окна бэкоффа, всё ещё "в работе", не
// "провалился" с точки зрения ЛК.
async function recomputeJobCounters(jobId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select id from import_jobs where id = $1 for update`, [jobId]);

    const counts = await client.query<{ done: string; failed: string; pending: string; total: string }>(
      `select
         count(*) filter (where status = 'done') as done,
         count(*) filter (where status = 'failed' and not retryable) as failed,
         count(*) filter (where status in ('queued', 'running') or (status = 'failed' and retryable)) as pending,
         count(*) as total
       from import_job_items where job_id = $1`,
      [jobId],
    );
    const row = counts.rows[0]!;
    const done = Number(row.done);
    const failed = Number(row.failed);
    const pending = Number(row.pending);
    const total = Number(row.total);

    const status = pending > 0 ? "running" : total > 0 && failed === total ? "failed" : "done";
    const finishedAt = pending > 0 ? null : new Date();

    await client.query(
      `update import_jobs
       set done_count = $2, failed_count = $3, total_count = $4, status = $5, finished_at = $6, updated_at = now()
       where id = $1`,
      [jobId, done, failed, total, status, finishedAt],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// Прогоняет джоб до исчерпания item, готовых к обработке ПРЯМО СЕЙЧАС (свежие + due-ретраи);
// item, ждущие будущего next_retry_at, остаются в очереди — job.status остаётся 'running' до
// следующего вызова (cron scripts/import-run.ts или ручной ретрай), который их и подберёт.
// connector уже привязан к одному auth-контексту на весь джоб (фабрика вида
// createCults3dConnector(auth), MF-739) — сюда auth не передаём.
export async function runImportJob(jobId: string, connector: ImportConnector, downloader: FileDownloader = defaultDownloader): Promise<void> {
  const jobResult = await pool.query<JobRow>(`select id, user_id, connection_id, source_platform, status from import_jobs where id = $1`, [jobId]);
  const job = jobResult.rows[0];
  if (!job) throw new Error("import job not found");

  if (job.status === "queued") {
    await pool.query(`update import_jobs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now() where id = $1`, [jobId]);
  }

  for (;;) {
    const item = await claimNextItem(jobId);
    if (!item) break;
    await processImportItem(job, item, connector, downloader);
    await recomputeJobCounters(jobId);
  }
}
