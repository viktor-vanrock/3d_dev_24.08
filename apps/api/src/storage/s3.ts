import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Logger } from "../logger.ts";
import type { Readable } from "node:stream";

let client: S3Client | null = null;

function getClient(): S3Client | null {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION ?? "ru-central-1",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }
  return client;
}

// Пишет в бакет `auth`. Без S3-креденшлов в окружении — не падает, только предупреждает:
// логин по PlagID остаётся рабочим через identifier_hash в Postgres и без сохранённого сырого объекта.
// Аудит-запись в S3 — best-effort, а не критический путь: любая ошибка S3 (сеть, права,
// недоступность бакета) логируется, но НЕ прерывает регистрацию/авторизацию пользователя.
export async function putAuthObject(key: string, body: Buffer, log: Logger): Promise<void> {
  const s3 = getClient();
  if (!s3) {
    log.warn(`S3 не сконфигурирован (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY) — auth/${key} не сохранён`);
    return;
  }
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_AUTH ?? "auth",
        Key: key,
        Body: body,
      }),
    );
  } catch (err) {
    log.error({ err }, `не удалось записать auth/${key} в S3 — продолжаем без аудит-объекта`);
  }
}

// Бакет `3mf` (модели, MF-8/MF-336) — тот же клиент/креды, отдельная переменная бакета.
function modelsBucket(): string {
  return process.env.S3_BUCKET_MODELS ?? "3mf";
}

// Роли, которые бакет-policy (MF-754) держит ЗА пределами публичного `public/*` — анонимный
// GET отдаёт 403 (fail-closed), доступ только presigned/service-креды. Список = protected-роли
// из docs/infra/readme.md § «Bucket-policy hardening `3mf`» (MF-755).
export const PROTECTED_ROLES = new Set(["source", "canonical_3mf", "cnc_program", "drawing", "gerber", "code_archive", "aux", "stl_derivative"]);

// Детерминированный ключ модели: {protected|public}/models/{model_id}/{role}.{ext} (MF-754/755,
// docs/infra/readme.md § «Bucket-policy hardening `3mf`»). Роль решает префикс: protected-роли
// (source/canonical_3mf/артефакты) — приватный prefix, вне public-read policy; всё остальное
// (preview/thumbnail/...) — публичный prefix, как раньше без регрессии.
// Внутренний staged-ключ резолвленного pinned артефакта под project-slice-request.v1 (MF-1986):
// байты, которые API уже прочитала из git и сверила по sha256 — Mesh читает ТОЛЬКО этот ключ,
// никогда client-URL (docs/architecture/project.manifest.md-стиль решения на MF-1981). Тот же
// account-scoped префикс `protected/slices/{accountId}/...`, что gcode-результат job'ы
// (slicing.route.ts::isAccountScopedSliceObject) — один и тот же bucket-policy periметр.
export function sliceSourceObjectKey(accountId: string, jobId: string, instanceId: string): string {
  return `protected/slices/${accountId}/${jobId}/sources/${instanceId}.bin`;
}

export function modelObjectKey(modelId: string, role: string, ext: string): string {
  const prefix = PROTECTED_ROLES.has(role) ? "protected" : "public";
  return `${prefix}/models/${modelId}/${role}.${ext}`;
}

export function isModelsStorageConfigured(): boolean {
  return getClient() !== null;
}

// Фото-аватарка (MF-357, Фаза 1 эпика MF-15) — свой бакет под Ops-заявку не заводим, живёт в
// уже провизионированном `3mf` под public/ (та же bucket-policy/offload/proxy-стрим инфраструктура,
// что у остальных публичных ролей выше). fileId — как в descriptionImageKey (models/
// descriptionimage.ts): новый файл на каждую загрузку, старый ключ убирает вызывающий код
// (deleteModelObject) при замене, не перезапись одного и того же имени.
export function avatarObjectKey(userId: string, fileId: string, ext: string): string {
  return `public/avatars/${userId}/${fileId}.${ext}`;
}

// Снапшоты персонажа-маскота (MF-446/MF-1030): ключ immutable и content-addressed.
// revision привязывает PNG к конкретному config, sha256 не позволяет двум разным байтам
// разделить один cache key. Старые версии удаляет вызывающий код best-effort после успешного
// CAS-апдейта БД; перезаписи текущего объекта больше нет.
export function avatarSnapshotObjectKey(userId: string, revision: number, side: "left" | "right" | "front", sha256: string, fileId: string, ext: string): string {
  return `public/avatars/${userId}/snapshots/${revision}/${side}-${sha256}-${fileId}.${ext}`;
}

// Медиа-вложение ленты (MF-1927, `feed/media.ts`) — та же схема владения, что аватарка выше
// (public/, userId в самом ключе), только префикс `feed`: ownership-check на публикации поста
// (feed/media.ts#feedMediaKeyOwnerId) читает userId из пути ключа, не заводит отдельную таблицу
// "кто загрузил". Публичный префикс — лента читается гостем (feed/detail.ts), не приватная роль.
export function feedMediaObjectKey(userId: string, fileId: string, ext: string): string {
  return `public/feed/${userId}/${fileId}.${ext}`;
}

// Картинка внутри markdown-тела поста (MF-1927, `feed/images.ts`, `feed_post_images`) — владение
// проверяется по автору поста в самом хендлере (postId уже под ACL), ключ не обязан кодировать
// userId, как feedMediaObjectKey выше.
export function feedPostImageObjectKey(postId: string, fileId: string, ext: string): string {
  return `public/feed/posts/${postId}/images/${fileId}.${ext}`;
}

// Стриминговая заливка — не буферит файл целиком в памяти (Upload сам режет на part'ы).
export async function putModelObjectStream(key: string, body: Readable, contentType: string, cacheControl?: string): Promise<void> {
  const s3 = getClient();
  if (!s3) throw new Error("S3 не сконфигурирован (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY)");
  const upload = new Upload({
    client: s3,
    params: { Bucket: modelsBucket(), Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl },
  });
  await upload.done();
}

export function deviceTransferObjectKey(ownerId: string, transferId: string, fileName: string): string {
  const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 255) || "transfer.bin";
  return `protected/device-transfers/${ownerId}/${transferId}/${safeName}`;
}

export async function putDeviceTransferObject(key: string, body: Buffer, contentType: string): Promise<{ readonly objectVersion: string } | null> {
  const s3 = getClient();
  if (!s3) return null;
  const result = await s3.send(new PutObjectCommand({ Bucket: modelsBucket(), Key: key, Body: body, ContentType: contentType, CacheControl: "no-store" }));
  const etag = result.ETag?.replaceAll('"', "");
  if (result.VersionId !== undefined) return { objectVersion: `version:${result.VersionId}` };
  if (etag !== undefined && etag.length > 0) return { objectVersion: `etag:${etag}` };
  throw new Error("device transfer upload did not return an immutable object version");
}

export async function getDeviceTransferObjectPresignedUrl(key: string, objectVersion: string, ttlSeconds = 300): Promise<string | null> {
  const s3 = getClient();
  if (!s3) return null;
  const versionId = objectVersion.startsWith("version:") ? objectVersion.slice("version:".length) : undefined;
  const ifMatch = objectVersion.startsWith("etag:") ? objectVersion.slice("etag:".length) : undefined;
  if ((versionId === undefined) === (ifMatch === undefined)) throw new Error("unsupported device transfer object version");
  const command = new GetObjectCommand({ Bucket: modelsBucket(), Key: key, VersionId: versionId, IfMatch: ifMatch });
  return getSignedUrl(s3, command, { expiresIn: Math.max(1, Math.min(300, Math.trunc(ttlSeconds))) });
}

export async function deleteModelObject(key: string): Promise<void> {
  const s3 = getClient();
  if (!s3) return;
  await s3.send(new DeleteObjectCommand({ Bucket: modelsBucket(), Key: key }));
}

// Бакет `generations` (генерация по тексту, MF-351/353) — заливает воркер apps/giga
// (apps/giga/src/giga/storage.py), api его только читает для проксирования превью/артефакта
// браузеру (тот же приём, что getModelObjectStream — MinIO приватный, presigned не достаёт).
function generationsBucket(): string {
  return process.env.S3_BUCKET_GENERATIONS ?? "generations";
}

export interface ModelObjectStream {
  body: Readable;
  contentLength?: number;
  etag?: string;
}

// Кадры съёмки (MF-2075) едут сюда же, в бакет генераций: они живут ровно до сборки модели,
// после чего apps/giga убирает их префикс целиком. Отдельный бакет ради временных файлов
// заводить незачем — читает их тот же сервис, что пишет результат.
export async function putGenerationObject(key: string, body: Buffer, contentType: string): Promise<boolean> {
  const s3 = getClient();
  if (!s3) return false;
  await s3.send(new PutObjectCommand({ Bucket: generationsBucket(), Key: key, Body: body, ContentType: contentType }));
  return true;
}

export async function countGenerationObjects(prefix: string): Promise<number> {
  const s3 = getClient();
  if (!s3) return 0;
  const result = await s3.send(new ListObjectsV2Command({ Bucket: generationsBucket(), Prefix: prefix }));
  return result.KeyCount ?? 0;
}

// Счёт именно КАДРОВ съёмки. Под тем же префиксом живёт manifest.json, и общий счёт объектов
// его тоже считал: params.photos получал 103 при 102 кадрах — поймано живой съёмкой.
export async function countGenerationPhotos(prefix: string): Promise<number> {
  const s3 = getClient();
  if (!s3) return 0;
  const result = await s3.send(new ListObjectsV2Command({ Bucket: generationsBucket(), Prefix: prefix }));
  return (result.Contents ?? []).filter((item) => /\/\d{4}\.jpg$/.test(item.Key ?? "")).length;
}

export function isGenerationStorageConfigured(): boolean {
  return getClient() !== null;
}

export async function getGenerationObjectStream(key: string): Promise<ModelObjectStream | null> {
  const s3 = getClient();
  if (!s3) return null;
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: generationsBucket(), Key: key }));
    if (!result.Body) return null;
    return {
      body: result.Body as Readable,
      contentLength: result.ContentLength,
      etag: result.ETag,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : undefined;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === "NoSuchKey" || name === "NotFound" || status === 404) return null;
    throw err;
  }
}

// MinIO на проде живёт на loopback — presigned URL браузер не достаёт (docs/epics/marketplace.md
// §1 п.13). API стримит ассеты preview/thumbnail сам через GetObject; MinIO остаётся приватным.
// Возвращает null, если объект не найден (вызывающий код отвечает 404), пробрасывает прочие ошибки.
// ВАЖНО (правило продукта, docs/epics/3mf.storage.md): исходник (`role: 'source'`) наружу
// никогда не отдаётся — это общий примитив хранилища, ограничение применяет вызывающий код.
export async function getModelObjectStream(key: string): Promise<ModelObjectStream | null> {
  const s3 = getClient();
  if (!s3) return null;
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: modelsBucket(), Key: key }));
    if (!result.Body) return null;
    return {
      body: result.Body as Readable,
      contentLength: result.ContentLength,
      etag: result.ETag,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : undefined;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === "NoSuchKey" || name === "NotFound" || status === 404) return null;
    throw err;
  }
}

// Бакет `printers-research` (MF-876, cloud.ru, public-read policy) — медиа карточек принтеров
// (`docs/infra/readme.md` § «Бакет №5»). Domain name ещё не включён (console-only, MF-715
// блокер), поэтому анонимный прямой URL пока не резолвится — раздача идёт presigned-GET-редиректом
// через API, тот же приём, что `getModelObjectPresignedUrl`/`makes/photos.ts`.
function printersResearchBucket(): string {
  return process.env.S3_BUCKET_PRINTERS_RESEARCH ?? "printers-research";
}

export function isPrintersResearchStorageConfigured(): boolean {
  return getClient() !== null;
}

// Presigned PUT — ресёрчер грузит байты напрямую в S3, минуя наш сервер (§2.4 research.workbench.md
// «presigned-загрузка сразу на выбор файла»). Ключ решает вызывающий код (research.route.ts),
// на слуге, не на printers.id — карточка ещё может быть не сохранена, когда фото уже льётся.
export async function getPrinterResearchUploadPresignedUrl(key: string, contentType: string, ttlSeconds = 300): Promise<string | null> {
  const s3 = getClient();
  if (!s3) return null;
  const command = new PutObjectCommand({ Bucket: printersResearchBucket(), Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn: ttlSeconds });
}

export async function getPrinterResearchObjectPresignedUrl(key: string, ttlSeconds = 120): Promise<string | null> {
  const s3 = getClient();
  if (!s3) return null;
  const command = new GetObjectCommand({ Bucket: printersResearchBucket(), Key: key });
  return getSignedUrl(s3, command, { expiresIn: ttlSeconds });
}

export async function deletePrinterResearchObject(key: string): Promise<void> {
  const s3 = getClient();
  if (!s3) return;
  await s3.send(new DeleteObjectCommand({ Bucket: printersResearchBucket(), Key: key }));
}

const DEFAULT_PRESIGNED_TTL_SECONDS = 120;

// Presigned GET для приватных ключей бакета `3mf` вне `public/*` (MF-754 bucket policy —
// fail-closed по умолчанию, покрывает и старую плоскую раскладку, и makes/{make_id}/... из
// MF-782). Раньше presigned не годился, пока S3_ENDPOINT указывал на MinIO на loopback VDS
// (браузер не достаёт localhost) — прод-cutover на cloud.ru (MF-709/715) снял это ограничение,
// эндпоинт теперь публичный, presigned-ссылка резолвится напрямую. null — S3 не сконфигурирован,
// вызывающий код продолжает проксировать поток через getModelObjectStream (тот же fallback, что
// у остальных ролей выше).
// overrides — те же response-content-type/-disposition, что withResponseOverrides добавлял query-
// параметром поверх голого публичного URL (MF-709). Presigned URL так делать нельзя: SigV4 подписывает
// конкретный набор query-параметров, дописанный постфактум response-content-* инвалидирует подпись
// (SignatureDoesNotMatch). Поэтому overrides идут в GetObjectCommand ДО getSignedUrl — S3 подписывает
// их как часть запроса (ResponseContentType/ResponseContentDisposition — стандартные поля GetObject).
export async function getModelObjectPresignedUrl(
  key: string,
  ttlSeconds = DEFAULT_PRESIGNED_TTL_SECONDS,
  overrides?: { contentType?: string; contentDisposition?: string },
): Promise<string | null> {
  const s3 = getClient();
  if (!s3) return null;
  const command = new GetObjectCommand({
    Bucket: modelsBucket(),
    Key: key,
    ResponseContentType: overrides?.contentType,
    ResponseContentDisposition: overrides?.contentDisposition,
  });
  return getSignedUrl(s3, command, { expiresIn: ttlSeconds });
}

// Offload публичного чтения (MF-709/MF-703): `3mf`/`generations` — public-read на cloud.ru
// (MF-707), но анонимный прямой URL резолвится только после того, как Cloud.ru проставит
// Global/Domain name бакету (MF-715, console-only) и Ops пропишет S3_PUBLIC_* в env (MF-708).
// До тех пор S3_PUBLIC_ENDPOINT остаётся незаданным — isPublicOffloadEnabled() возвращает
// false, и вызывающий код продолжает отдавать объект прокси-стримом (текущее поведение,
// без правки кода на cutover). `auth`/`backups` сюда не заведены — они приватные и прямых
// URL не имеют.
function publicUrlBase(): string | null {
  return process.env.S3_PUBLIC_ENDPOINT || null;
}

// Cloud.ru подтвердил живым curl без кред (MF-715): голый path-style `s3.cloud.ru/<bucket>/<key>`
// НЕ рабочий анонимно ни временно, ни постоянно (сервер требует tenant id даже на чтение) — это
// НЕ валидный дефолт. Рабочие анонимные схемы ровно две: virtual-hosted через Domain name
// (`<bucket-или-domain-name>.s3.cloud.ru/<key>`) или через Global name (`global.s3.cloud.ru/
// <global-name>/<key>` — структурно тот же path-style, просто с фиксированным global-хостом и
// global-именем вместо голого имени бакета). Обе требуют, чтобы имя было проставлено в консоли
// cloud.ru (MF-715, ещё blocked). Поэтому стиль не имеет безопасного дефолта — не задан явно
// (или задано что-то незнакомое) → offload считается невключённым (fail closed), даже если
// S3_PUBLIC_ENDPOINT уже прописан кем-то заранее.
function publicUrlStyle(): "vhost" | "global" | null {
  const style = process.env.S3_PUBLIC_URL_STYLE;
  return style === "vhost" || style === "global" ? style : null;
}

export function isPublicOffloadEnabled(): boolean {
  return publicUrlBase() !== null && publicUrlStyle() !== null;
}

function buildPublicUrl(bucket: string, key: string): string {
  const base = (publicUrlBase() as string).replace(/\/+$/, "");
  if (publicUrlStyle() === "vhost") {
    const { protocol, host } = new URL(base);
    return `${protocol}//${bucket}.${host}/${key}`;
  }
  // "global": S3_PUBLIC_ENDPOINT должен быть выставлен на https://global.s3.cloud.ru, а
  // соответствующий S3_BUCKET_* — на global-name из консоли (не обязательно совпадает с
  // именем самого бакета) — это ответственность конфигурации (MF-708), не этого кода.
  return `${base}/${bucket}/${key}`;
}

// null, пока offload не включён конфигом (S3_PUBLIC_ENDPOINT) — вызывающий код в этом случае
// продолжает отдавать объект через существующий прокси-стрим.
export function modelPublicUrl(key: string): string | null {
  return isPublicOffloadEnabled() ? buildPublicUrl(modelsBucket(), key) : null;
}

export function generationPublicUrl(key: string): string | null {
  return isPublicOffloadEnabled() ? buildPublicUrl(generationsBucket(), key) : null;
}

// Скачивание (download.ts) отдаёт человекочитаемое имя через Content-Disposition — при прокси-
// стриме это заголовок нашего ответа, при прямом URL с cloud.ru объекта своего заголовка нет
// (ключ вида models/{id}/canonical_3mf.3mf). GetObject поддерживает override через query-параметры
// response-content-type/response-content-disposition (часть S3 API, применяется и к анонимному
// public-read GET) — прокидываем то же имя файла, что раньше шло в заголовке проксёра.
export function withResponseOverrides(url: string, overrides: { contentType?: string; contentDisposition?: string }): string {
  const withParams = new URL(url);
  if (overrides.contentType) withParams.searchParams.set("response-content-type", overrides.contentType);
  if (overrides.contentDisposition) {
    withParams.searchParams.set("response-content-disposition", overrides.contentDisposition);
  }
  return withParams.toString();
}
