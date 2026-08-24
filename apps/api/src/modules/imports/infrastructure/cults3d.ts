import type { ExternalFile, ExternalImage, ExternalModelMeta, ExternalModelSummary, ImportAuth, ImportConnector } from "./connector.ts";
import { markConnectionVerifiedByAuth } from "../../importConnections/public/index.ts";
import { PermanentImportItemError } from "../domain/import-errors.ts";

// Коннектор Cults3D (MF-37/MF-417, стадия 3 — эта карточка) поверх интерфейса из MF-739.
// GraphQL, https://cults3d.com/graphql, Basic-auth base64(username:api_key) — ключ на
// cults3d.com/en/api/keys выпускает только владелец аккаунта. Официальный публичный контракт
// (см. карточку и cults3d.com/en/api/docs): корень авторизованных запросов — `myself`, портфолио
// автора — `myself.creations` (свои опубликованные модели, файлы через `blueprints`) и
// `myself.printlists` (сохранённые/напечатанные чужие модели — nested `creation`); скачивание
// КУПЛЕННЫХ моделей — `myself.orders[].downloadUrl`, не `blueprints` (blueprints доступен только
// авторам их собственных публикаций).

export const CULTS3D_API_URL = "https://cults3d.com/graphql";

// Честная атрибуция в UA (карточка, п. "Честный User-Agent с атрибуцией") — источник видит, кто
// стучится и куда писать при проблемах, вместо анонимного бота.
const USER_AGENT = "3mf.tech-importer/1.0 (+https://3mf.tech; import-connector; contact: support@3mf.tech)";

// Лимиты источника (карточка): ~60 запросов/30с, ~500/день. Дневной лимит не считаем отдельным
// счётчиком в процессе (он живёт короткоживущим воркер-прогоном, не сервисом) — при его
// исчерпании источник просто вернёт 429/5xx, что уже ведёт на общий бэкофф джоба
// (import_job_items.next_retry_at/attempt_count, apps/api/src/modules/imports/application/import-worker.ts), тот самый
// механизм, который карточка просит переиспользовать, а не городить отдельный. Окно 60/30с —
// единственное, что имеет смысл держать самим клиентом: без него нормальный прогон джоба на
// десятки item сам себе сгенерит пачку 429 за секунды.
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Скользящее окно на клиенте — не про корректность (источник — источник правды по лимиту), а
// про то, чтобы обычный прогон не долбил 429 на ровном месте. Инжектируемые now()/sleep() —
// юнит-тесты гоняют это без реальных задержек (fake timers).
export class SlidingWindowLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const cutoff = this.now() - this.windowMs;
      while (this.timestamps.length > 0 && this.timestamps[0]! <= cutoff) this.timestamps.shift();
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(this.now());
        return;
      }
      const delay = this.timestamps[0]! + this.windowMs - this.now();
      await this.wait(Math.max(delay, 1));
    }
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

// "Не твоя модель"/не найдено — источник сказал это явно, ретраить бессмысленно
// (PermanentImportItemError, см. комментарий worker.ts). Всё остальное транзиентное (429/5xx/
// сетевая ошибка) — обычный Error, обычный бэкофф джоба.
const PERMANENT_ERROR_RE = /not found|forbidden|permission|unauthor|access denied/i;

interface RawCreation {
  id?: unknown;
  name?: unknown;
  shortUrl?: unknown;
  url?: unknown;
  description?: unknown;
  license?: unknown;
  tagNames?: unknown;
  category?: { name?: unknown } | null;
  illustrationImageUrl?: unknown;
  imageUrls?: unknown;
  nbLikes?: unknown;
  nbDownloads?: unknown;
  nbViews?: unknown;
  blueprints?: { fileUrl?: unknown; imageUrl?: unknown; filename?: unknown }[] | null;
}

interface RawOrder {
  creation?: { id?: unknown } | null;
  downloadUrl?: unknown;
  filename?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toSummary(raw: RawCreation): ExternalModelSummary | null {
  const externalId = str(raw.id);
  const title = str(raw.name);
  const originalUrl = str(raw.shortUrl) ?? str(raw.url);
  if (!externalId || !title || !originalUrl) return null;
  const summary: ExternalModelSummary = { externalId, title, originalUrl };
  const thumbnailUrl = str(raw.illustrationImageUrl);
  if (thumbnailUrl) summary.thumbnailUrl = thumbnailUrl;
  return summary;
}

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    return last && last.includes(".") ? last : fallback;
  } catch {
    return fallback;
  }
}

// Одна фабрика на джоб/аккаунт-источник (MF-739): connectionId известен на нормальном прогоне
// джоба (import-run.ts подгружает его вместе с auth). На самой первой проверке ключа при
// подключении аккаунта connectionId ещё не существует (строка import_connections появляется
// только ПОСЛЕ успешной проверки — тот же порядок, что connectPrusaAccount) — там верификацию
// делает вызывающий код (cults3d.sync.ts::connectCults3dAccount) явно, connector в этом случае
// получает null и просто не пытается отметить то, чего ещё нет.
export function createCults3dConnector(auth: ImportAuth, connectionId: string | null, opts: { fetchImpl?: typeof fetch; limiter?: SlidingWindowLimiter } = {}): ImportConnector {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const limiter = opts.limiter ?? new SlidingWindowLimiter(RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  let verifiedOnce = false;

  async function markVerifiedOnce(): Promise<void> {
    if (verifiedOnce || !connectionId) return;
    verifiedOnce = true;
    await markConnectionVerifiedByAuth(connectionId);
  }

  async function request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    await limiter.acquire();

    const credentials = Buffer.from(`${auth.username}:${auth.apiKey}`).toString("base64");
    let response: Response;
    try {
      response = await fetchImpl(CULTS3D_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${credentials}`,
          "user-agent": USER_AGENT,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      throw new Error(`Cults3D GraphQL: сетевая ошибка — ${err instanceof Error ? err.message : String(err)}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new PermanentImportItemError("Cults3D отклонил ключ авторизации (401/403)");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`Cults3D GraphQL вернул ${response.status} — транзиентно, повтор с бэкоффом джоба`);
    }
    if (!response.ok) {
      throw new Error(`Cults3D GraphQL вернул ${response.status}`);
    }

    const body = (await response.json()) as GraphQLResponse<T>;
    if (body.errors && body.errors.length > 0) {
      const message = body.errors.map((e) => e.message).join("; ");
      if (PERMANENT_ERROR_RE.test(message)) throw new PermanentImportItemError(`Cults3D: ${message}`);
      throw new Error(`Cults3D GraphQL error: ${message}`);
    }
    if (!body.data) throw new Error("Cults3D GraphQL: ответ без data");

    await markVerifiedOnce();
    return body.data;
  }

  async function findOrder(externalId: string): Promise<RawOrder | null> {
    const data = await request<{ myself: { orders: RawOrder[] } | null }>(
      `query MyOrders($limit: Int!) {
        myself {
          orders(limit: $limit) {
            creation { id }
            downloadUrl
            filename
          }
        }
      }`,
      { limit: 200 },
    );
    const orders = data.myself?.orders ?? [];
    return orders.find((o) => str(o.creation?.id) === externalId) ?? null;
  }

  return {
    async listOwnModels(_forAuth: ImportAuth): Promise<ExternalModelSummary[]> {
      const data = await request<{
        myself: {
          creations: RawCreation[] | null;
          printlists: { creation: RawCreation | null }[] | null;
        } | null;
      }>(
        `query OwnPortfolio($limit: Int!) {
          myself {
            creations(limit: $limit) { id name shortUrl illustrationImageUrl }
            printlists(limit: $limit) { creation { id name shortUrl illustrationImageUrl } }
          }
        }`,
        { limit: 100 },
      );

      const byId = new Map<string, ExternalModelSummary>();
      for (const raw of data.myself?.creations ?? []) {
        const summary = toSummary(raw);
        if (summary) byId.set(summary.externalId, summary);
      }
      for (const entry of data.myself?.printlists ?? []) {
        if (!entry.creation) continue;
        const summary = toSummary(entry.creation);
        if (summary && !byId.has(summary.externalId)) byId.set(summary.externalId, summary);
      }
      return [...byId.values()];
    },

    async resolveMeta(externalId: string): Promise<ExternalModelMeta> {
      const data = await request<{ creation: RawCreation | null }>(
        `query CreationMeta($id: ID!) {
          creation(id: $id) {
            id
            name
            shortUrl
            description
            license
            tagNames
            category { name }
            imageUrls
            illustrationImageUrl
            nbLikes: likesCount
            nbDownloads: downloadsCount
            nbViews: viewsCount
          }
        }`,
        { id: externalId },
      );
      const raw = data.creation;
      if (!raw || !str(raw.id)) throw new PermanentImportItemError(`Cults3D: модель ${externalId} не найдена`);

      const originalUrl = str(raw.shortUrl) ?? str(raw.url);
      if (!originalUrl) throw new PermanentImportItemError(`Cults3D: у модели ${externalId} нет ссылки на источник`);

      const popularity: Record<string, number> = {};
      const nbLikes = num(raw.nbLikes);
      const nbDownloads = num(raw.nbDownloads);
      const nbViews = num(raw.nbViews);
      if (nbLikes !== undefined) popularity.nbLikes = nbLikes;
      if (nbDownloads !== undefined) popularity.nbDownloads = nbDownloads;
      if (nbViews !== undefined) popularity.nbViews = nbViews;

      const tags = Array.isArray(raw.tagNames) ? raw.tagNames.filter((t): t is string => typeof t === "string") : [];

      return {
        externalId,
        originalUrl,
        title: str(raw.name) ?? externalId,
        description: str(raw.description),
        license: str(raw.license) ?? "unknown",
        tags,
        category: str(raw.category?.name),
        popularity,
        raw,
      };
    },

    // Файлы своей публикации — `creation.blueprints` (доступно только автору). Не своя (куплена/
    // получена по заказу) — `blueprints` пуст, файл достаётся через `myself.orders[].downloadUrl`
    // (карточка, п. "поле downloadUrl в orders/sales"). Ничего ни там, ни там — источник не
    // отдал доступа к файлам этой модели вообще, ретраить нет смысла.
    async fetchFiles(externalId: string): Promise<ExternalFile[]> {
      const data = await request<{ creation: RawCreation | null }>(
        `query CreationBlueprints($id: ID!) {
          creation(id: $id) { id blueprints { fileUrl imageUrl filename } }
        }`,
        { id: externalId },
      );
      const blueprints = data.creation?.blueprints ?? [];
      const ownFiles: ExternalFile[] = [];
      for (const bp of blueprints) {
        const downloadUrl = str(bp.fileUrl);
        if (!downloadUrl) continue;
        const filename = str(bp.filename) ?? filenameFromUrl(downloadUrl, `${externalId}.stl`);
        ownFiles.push({ filename, downloadUrl });
      }
      if (ownFiles.length > 0) return ownFiles;

      const order = await findOrder(externalId);
      if (!order) return [];
      const downloadUrl = str(order.downloadUrl);
      if (!downloadUrl) return [];
      const filename = str(order.filename) ?? filenameFromUrl(downloadUrl, `${externalId}.stl`);
      return [{ filename, downloadUrl }];
    },

    async fetchImages(externalId: string): Promise<ExternalImage[]> {
      const data = await request<{ creation: RawCreation | null }>(
        `query CreationImages($id: ID!) {
          creation(id: $id) { id illustrationImageUrl imageUrls }
        }`,
        { id: externalId },
      );
      const raw = data.creation;
      if (!raw) return [];

      const images: ExternalImage[] = [];
      const illustration = str(raw.illustrationImageUrl);
      if (illustration) images.push({ url: illustration, isPrimary: true });

      const rest = Array.isArray(raw.imageUrls) ? raw.imageUrls.filter((u): u is string => typeof u === "string") : [];
      for (const url of rest) {
        if (url === illustration) continue;
        images.push({ url });
      }
      return images;
    },
  };
}
