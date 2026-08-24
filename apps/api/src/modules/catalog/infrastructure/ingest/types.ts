// Контракт адаптера источника (MF-406 «каркас агента-парсера», Фаза 2 эпика MF-32).
// Один адаптер = один источник (вендор-сайт по шаблону, каталог, слайсер-профиль, LLM-
// экстрактор свободного HTML — src/modules/catalog/infrastructure/ingest/run.ts § runIngest). fetch() отдаёт сырые
// кандидаты уже нормализованными в JSON по схеме канонической записи станка (единицы/словари/
// RU↔EN имён — на совести конкретного адаптера; общие хелперы см. ./units.ts). runIngest()
// берёт на себя идемпотентность по content_hash, запись в machine_candidates и аудит-лог
// (ingest_runs, schema.ts). Дедуп/матчинг/merge сырых кандидатов в канон machines — отдельный
// пайплайн (entity resolution, не входит в этот каркас — см. декомпозицию MF-406).
export interface RawCandidate {
  /** Стабильный внешний идентификатор записи у источника (не меняется между прогонами) —
   *  вместе с adapter.id образует unique(source, external_ref) в machine_candidates. */
  externalRef: string;
  sourceUrl?: string;
  raw: unknown;
}

export interface SourceAdapter {
  /** Совпадает с machine_candidates.source и ingest_runs.source. */
  id: string;
  fetch(): Promise<RawCandidate[]>;
}

export interface IngestRunResult {
  found: number;
  changed: number;
  rejected: number;
}
