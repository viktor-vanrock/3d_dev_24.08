// Шов `jobs` — API (`apps/api`, продюсер: событие «README/title/tags изменились»,
// docs/epics/neural.index.contract.md §2) → apps/search воркер (консюмер: model-index.v1,
// apps/search/src/portal_search/index_lease.py + worker.py). MF-1998 поверх MF-2003 (Data).
//
// Схема — `search_index_jobs`/`model_embeddings`
// (apps/api/db/migrations/20260720110000_versioned_search_index.sql, Data, ПРИМЕНЕНА в
// origin/dev) — эта часть НЕ черновик, типы ниже описывают уже существующие таблицы. Только
// тип/схема (§ «никакой бизнес-логики»); полное решение —
// docs/architecture/neural.search.md § «Versioned индекс» + docs/contracts/model.index.v1.md.
//
// AI-расширение поверх этой схемы (multi-view профили ракурсов рендера,
// apps/search/src/portal_search/profiles.py) НЕ проходило ревью Data/CTO — см.
// docs/contracts/model.index.v1.md § «Открыто».

export const MODEL_INDEX_CONTRACT_VERSION = "model-index.v1" as const;

export const SEARCH_INDEX_JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type SearchIndexJobStatus = (typeof SEARCH_INDEX_JOB_STATUSES)[number];

export const MODEL_EMBEDDING_DIMS = [1024, 2048] as const;
export type ModelEmbeddingDim = (typeof MODEL_EMBEDDING_DIMS)[number];

export interface ModelIndexV1QueueJob extends ModelEmbeddingProfileIdentity {
  readonly queue: typeof MODEL_INDEX_CONTRACT_VERSION;
  readonly correlationId: string;
  readonly dimensions: ModelEmbeddingDim;
  readonly textSha256: Uint8Array;
}

/**
 * Identity одного профиля эмбеддинга модели — общая для `search_index_jobs` (очередь) и
 * `model_embeddings` (результат). Уникальна как `(modelId, embeddingModel, embeddingVersion)`
 * (`*_identity` constraint в схеме). Один `modelId` может иметь НЕСКОЛЬКО строк — разных
 * профилей — это и есть параллельный rollout 1024 (`gigachat/Embeddings`) / 2048
 * (`hyperpc/qwen3-vl-embedding-2b`, halfvec — pgvector не строит HNSW на `vector` с dim>2000).
 */
export interface ModelEmbeddingProfileIdentity {
  modelId: string;
  embeddingModel: string;
  embeddingVersion: string;
}

/**
 * Ряд `search_index_jobs` — что кладёт API при постановке в очередь (повторная постановка той
 * же identity — `ON CONFLICT DO UPDATE`, обновляет ту же строку и увеличивает `generation`, не
 * плодит дубли). `textSha256` — hex/base64 представление `bytea`-хэша нормализованного
 * `title+description+tags`-документа (`docs/epics/neural.index.contract.md` §0) для текстовых
 * профилей; для профилей ракурсов рендера (AI-расширение, см. выше) — хэш содержимого
 * геометрического файла, то же поле переиспользуется по смыслу «хэш источника».
 */
export interface SearchIndexJobRow extends ModelEmbeddingProfileIdentity {
  id: string;
  dim: ModelEmbeddingDim;
  textSha256: string;
  status: SearchIndexJobStatus;
  /**
   * Фенсинг-токен: монотонно растёт при КАЖДОЙ постановке в очередь этой identity, включая
   * поверх уже `running` строки. Воркер обязан записывать результат в `model_embeddings`
   * условно (`WHERE model_embeddings.source_generation < excluded.source_generation`) —
   * опоздавшая попытка со старым `generation` не может переписать более свежий текст.
   */
  generation: number;
  attempts: number;
  leasedBy: string | null;
  leasedUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Ряд `model_embeddings` — материализованный результат. Строка появляется, только когда
 * эмбеддинг реально посчитан (нет pending-заглушек). Ровно одно из `embedding1024`/
 * `embedding2048` заполнено — определяется `dim` (`model_embeddings_dim_column` constraint).
 * `indexStatus: "stale"` — модель отредактирована после того, как этот профиль был
 * проиндексирован; не блокирует чтение — гибридный поиск (MF-1998) продолжает отдавать этот
 * вектор, пока свежий не досчитается («Готово когда»: не проседать в 0 результатов на время
 * реиндексации).
 */
export interface ModelEmbeddingRow extends ModelEmbeddingProfileIdentity {
  id: string;
  dim: ModelEmbeddingDim;
  embedding1024: number[] | null;
  embedding2048: number[] | null;
  textSha256: string;
  indexStatus: "ready" | "stale";
  sourceGeneration: number;
  indexedAt: string;
  createdAt: string;
  updatedAt: string;
}
