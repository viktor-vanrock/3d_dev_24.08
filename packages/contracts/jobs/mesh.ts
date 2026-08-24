// Шов jobs/mesh — контракт "деривативных" ассетов между apps/mesh (продюсер) и
// apps/api (консюмер), см. README.md этой папки. Пока не очередь job'ов — единственная
// опубликованная часть: детерминированный S3-ключ превью детали гайда сборки (MF-1011,
// часть MF-367/MF-18). Только тип/схема (§ "никакой бизнес-логики" — реализация ключа
// живёт в apps/mesh/src/mesh/storage.py, apps/api реализует сборку ключа сам).

/**
 * Деталь (объект) внутри канонического мультиобъектного 3MF модели.
 * `partId` — имя объекта, как оно попало в canonical_3mf.3mf при конвертации
 * (`mesh.part_preview`); гайд сборки хранит его в `build_steps.mesh_object_ref`
 * (миграция 20260711190000_build_guide_foundation.sql — поле не констрейнится
 * в БД, потребитель формата это apps/api через этот контракт).
 */
export interface MeshPartRef {
  modelId: string;
  partId: string;
}

/**
 * S3-ключи превью детали (бакет `3mf`, публичный prefix):
 *
 *   glb:   public/models/{modelId}/parts/{partIdSlug}/preview.glb
 *   thumb: public/models/{modelId}/parts/{partIdSlug}/thumb.webp
 *
 * `partIdSlug` = первые 20 hex-символов sha256(partId), utf-8 — та же формула
 * в apps/mesh (`mesh.storage.part_id_slug`) и в apps/api (реализовать через
 * `node:crypto`). Хэш вместо санитайза: `partId` приходит из пользовательского
 * исходника (кириллица/пробелы/слэши) — вражеский вход для сегмента S3-пути,
 * хэш снимает вопрос экранирования на обеих сторонах шва.
 *
 * Объекты в S3 льются воркером best-effort ПОСЛЕ того, как модель стала ready
 * (apps/mesh/src/mesh/worker.py, store_part_previews_from_canonical) — только
 * для моделей с >1 деталью в каноне; однодетальные модели используют превью
 * всей сборки (models/{modelId}/preview.glb, models/{modelId}/thumb.webp) как
 * превью единственной детали — отдельный /parts/ ключ для них не льётся.
 * Наличие объекта в S3 не гарантировано (best-effort, как STL-дериватив) —
 * apps/api должен graceful-деградировать на 404/отсутствие так же, как для
 * превью всей модели (fallback-постер).
 */
export interface MeshPartPreviewKeys {
  glbKey: string;
  thumbnailKey: string;
}

// --- mesh-conversion.v1 ----------------------------------------------------------------------

/** API outbox -> Mesh conversion promotion contract for one immutable model revision. */
export const MESH_CONVERSION_JOB_CONTRACT_VERSION = "mesh-conversion.v1" as const;

export interface MeshConversionV1QueueJob {
  readonly queue: typeof MESH_CONVERSION_JOB_CONTRACT_VERSION;
  readonly eventId: string;
  readonly projectId: string;
  readonly modelId: string;
  readonly revisionId: string;
  /** Persisted inside this domain event payload because outbox_events has no generic column. */
  readonly correlationId: string;
}

export function isMeshConversionV1QueueJob(value: unknown): value is MeshConversionV1QueueJob {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  return (
    Object.keys(job).length === 6 &&
    job.queue === MESH_CONVERSION_JOB_CONTRACT_VERSION &&
    typeof job.eventId === "string" &&
    typeof job.projectId === "string" &&
    typeof job.modelId === "string" &&
    typeof job.revisionId === "string" &&
    typeof job.correlationId === "string"
  );
}
