// Шов http/search.ts — apps/api/src/models (Back, продюсер) → apps/web (Front, консюмер).
// Расширяет существующий GET /models?q=..., тот же эндпоинт (docs/epics/neural.index.contract.md
// §4: «этот же параметр q, тот же эндпоинт» — ILIKE → гибрид под капотом, Front не переключается
// на новый URL). Решение и владение — MF-1999 «Contract decision» §1, docs/architecture/
// neural.search.md (giga /embed: model=Embeddings, dim=1024). Аддитивно поверх сегодняшнего
// JSON-ответа GET /models (apps/api/src/models/list.ts) — models/has_more/next_cursor/facets
// этим файлом не переопределяются, здесь только новый search-специфичный конверт полей.

export const MODEL_SEARCH_CONTRACT_VERSION = "model-search.v1" as const;

export const MODEL_SEARCH_MODES = ["hybrid", "lexical"] as const;
export type ModelSearchMode = (typeof MODEL_SEARCH_MODES)[number];

/**
 * `?search_mode=` — опционально. Клиент без параметра получает поведение по умолчанию
 * (гибрид под капотом, тихий fallback на `lexical` при недоступности embedding-бэкенда —
 * см. `degraded` ниже). Explicit `"lexical"` — принудительно пропустить векторный поиск.
 */
export interface ModelSearchRequestQuery {
  search_mode?: ModelSearchMode;
}

/**
 * Аддитивные поля ответа `GET /models` при заданном `?q=` (в переходный период клиент без
 * `search_mode` в запросе продолжает получать рабочий ответ той же формы каталога — сами эти
 * поля УЖЕ добавлены producer'ом, отсутствие обработки на старой стороне Front не ломает
 * парсинг остального объекта). Приватность (MF-1999 §1): сырой score и имя embedding-модели
 * (`Embeddings`/`GigaEmbeddings`) НЕ публикуются наружу — максимум порядковый `relevance_rank`
 * потом, если понадобится UI (вне периметра v1 ниже).
 */
export interface ModelSearchResponseFields {
  contract_version: typeof MODEL_SEARCH_CONTRACT_VERSION;
  /** Генерит сервер на каждый запрос — для корреляции логов и `ModelSearchQueryEvent` ниже. */
  request_id: string;
  /** Реально применённый режим — может отличаться от запрошенного (см. `degraded`). */
  search_mode_used: ModelSearchMode;
  /**
   * `true` — только когда embedding-бэкенд недоступен и API тихо упало на `lexical`. Это НЕ
   * ошибка контракта (запрос отработал, просто не гибридным путём) — Front не должен
   * трактовать `degraded` как отказ поиска.
   */
  degraded?: true;
}

export const MODEL_SEARCH_ERROR_CODES = [
  "model_search_invalid_query",
  "model_search_contract_version_unsupported",
] as const;
export type ModelSearchErrorCode = (typeof MODEL_SEARCH_ERROR_CODES)[number];

export interface ModelSearchError {
  error: ModelSearchErrorCode;
}

/** Observability-событие `model_search.query.v1` (MF-1999 §1) — эмитится на каждый непустой q. */
export interface ModelSearchQueryEvent {
  request_id: string;
  search_mode_used: ModelSearchMode;
  degraded: boolean;
  latency_ms: number;
  result_count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isModelSearchMode(value: unknown): value is ModelSearchMode {
  return typeof value === "string" && (MODEL_SEARCH_MODES as readonly string[]).includes(value);
}

/** Structural guard — Front обязан отклонить неизвестную contract_version, не понижать молча. */
export function isModelSearchResponseFields(value: unknown): value is ModelSearchResponseFields {
  if (!isRecord(value)) return false;
  if (value.contract_version !== MODEL_SEARCH_CONTRACT_VERSION) return false;
  if (typeof value.request_id !== "string" || value.request_id.length === 0) return false;
  if (!isModelSearchMode(value.search_mode_used)) return false;
  if (value.degraded !== undefined && value.degraded !== true) return false;
  return true;
}
