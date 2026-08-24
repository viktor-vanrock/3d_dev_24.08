/**
 * `assistant.prompt-variants.v1` (MF-2068, родительский эпик — тот же, что MF-1996/MF-1999,
 * docs/epics/neural.search.md) — синхронный шов `apps/api/src/assistant` (продюсер) →
 * `apps/web` главная (консюмер): свободный текст запроса → нормализованный intent + 4–6
 * конкретных вариантов промпта для генерации 3D; `batch` продолжает бесконечную ленту без
 * повторения уже показанных тем. Отдельный контракт-файл от `http/assistant.ts`
 * (не расширение `AssistantRunResult`) — это НЕ часть thread/run/SSE-жизненного цикла ассистента
 * сборки, синхронный запрос-ответ без очереди, тот же класс шва, что `http/search.ts`
 * (model-search.v1) поверх `GET /models`.
 *
 * `catalog_matches` — переиспользует форму `AssistantSearchResultItem` (та же карточка каталога,
 * что уже показывает `search_results`) — намеренно тот же тип, не копия.
 */

import type { AssistantSearchResultItem } from "./assistant.ts";

export const PROMPT_VARIANTS_CONTRACT_VERSION = "assistant.prompt-variants.v1" as const;

/** v1 — только главная; расширяется по мере появления других мест ввода запроса. */
export const PROMPT_VARIANTS_CONTEXTS = ["home"] as const;
export type PromptVariantsContext = (typeof PROMPT_VARIANTS_CONTEXTS)[number];

export const PROMPT_VARIANTS_QUERY_MAX_LENGTH = 300;
export const PROMPT_VARIANTS_MIN_LIMIT = 4;
export const PROMPT_VARIANTS_MAX_LIMIT = 6;
export const PROMPT_VARIANTS_DEFAULT_LIMIT = 6;
export const PROMPT_VARIANTS_MAX_BATCH = 10_000;
export const PROMPT_VARIANTS_EXCLUDE_MAX_ITEMS = 48;
export const PROMPT_VARIANTS_EXCLUDE_LABEL_MAX_LENGTH = 80;

export interface PromptVariantsRequest {
  query: string;
  /** По умолчанию `"home"` — сегодня единственное значение (см. `PROMPT_VARIANTS_CONTEXTS`). */
  context?: PromptVariantsContext;
  /** `PROMPT_VARIANTS_MIN_LIMIT..PROMPT_VARIANTS_MAX_LIMIT`, по умолчанию `PROMPT_VARIANTS_DEFAULT_LIMIT`. */
  limit?: number;
  /** Номер батча бесконечной ленты, 0 — первый экран. */
  batch?: number;
  /** Уже показанные направления: Gemma обязана придумать другие, а не перефразировать их. */
  exclude_labels?: string[];
}

export interface PromptVariantIntent {
  normalized_query: string;
  /** Свободный текстовый мотив ("дракон", "ваза с рельефом") — `null`, когда LLM не смогла его выделить. */
  motif: string | null;
}

export interface PromptVariant {
  /** `${request_id}-${index}` — стабилен только в рамках одного ответа, не переиспользуется между запросами. */
  id: string;
  label: string;
  prompt: string;
  motif: string | null;
  /** `0..1`, честная оценка LLM — `0` для heuristic-фоллбэка при `degraded`, фронт не сортирует по нему сам. */
  confidence: number;
}

export interface PromptVariantsResponse {
  contract_version: typeof PROMPT_VARIANTS_CONTRACT_VERSION;
  /** Генерит сервер на каждый запрос — тот же приём, что `model-search.v1::request_id`. */
  request_id: string;
  intent: PromptVariantIntent;
  variants: PromptVariant[];
  /** До 4 существующих моделей каталога, похожих на запрос (пусто — не ошибка). */
  catalog_matches: AssistantSearchResultItem[];
  /**
   * `true` — только когда apps/giga недоступен/вернул невалидный ответ и сервер тихо упал на
   * многовариантный heuristic-фоллбэк (см. `apps/api/src/assistant/promptVariants.ts`). Та же
   * дисциплина, что `model-search.v1::degraded` — это НЕ ошибка контракта.
   */
  degraded?: true;
}

export const PROMPT_VARIANTS_ERROR_CODES = [
  "prompt_variants_query_required",
  "prompt_variants_query_too_long",
  "prompt_variants_query_not_allowed",
  "prompt_variants_invalid_context",
  "prompt_variants_invalid_limit",
  "prompt_variants_invalid_batch",
  "prompt_variants_invalid_exclude_labels",
  "prompt_variants_rate_limited",
] as const;
export type PromptVariantsErrorCode = (typeof PROMPT_VARIANTS_ERROR_CODES)[number];

export interface PromptVariantsError {
  error: PromptVariantsErrorCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isPromptVariantsContext(value: unknown): value is PromptVariantsContext {
  return typeof value === "string" && (PROMPT_VARIANTS_CONTEXTS as readonly string[]).includes(value);
}

export function isPromptVariantsRequest(value: unknown): value is PromptVariantsRequest {
  if (!isRecord(value)) return false;
  if (typeof value.query !== "string" || value.query.trim().length === 0) return false;
  if (value.context !== undefined && !isPromptVariantsContext(value.context)) return false;
  if (value.limit !== undefined && typeof value.limit !== "number") return false;
  if (
    value.batch !== undefined &&
    (typeof value.batch !== "number" ||
      !Number.isInteger(value.batch) ||
      value.batch < 0 ||
      value.batch > PROMPT_VARIANTS_MAX_BATCH)
  ) {
    return false;
  }
  if (
    value.exclude_labels !== undefined &&
    (!Array.isArray(value.exclude_labels) ||
      value.exclude_labels.length > PROMPT_VARIANTS_EXCLUDE_MAX_ITEMS ||
      !value.exclude_labels.every(
        (label) =>
          typeof label === "string" &&
          label.trim().length > 0 &&
          label.trim().length <= PROMPT_VARIANTS_EXCLUDE_LABEL_MAX_LENGTH,
      ))
  ) {
    return false;
  }
  return true;
}

function isPromptVariant(value: unknown): value is PromptVariant {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.prompt === "string" &&
    (value.motif === null || typeof value.motif === "string") &&
    typeof value.confidence === "number"
  );
}

/** Structural guard — Front обязан отклонить неизвестную contract_version, не понижать молча. */
export function isPromptVariantsResponse(value: unknown): value is PromptVariantsResponse {
  if (!isRecord(value)) return false;
  if (value.contract_version !== PROMPT_VARIANTS_CONTRACT_VERSION) return false;
  if (typeof value.request_id !== "string" || value.request_id.length === 0) return false;
  if (!isRecord(value.intent) || typeof value.intent.normalized_query !== "string") return false;
  if (!Array.isArray(value.variants) || !value.variants.every(isPromptVariant)) return false;
  if (!Array.isArray(value.catalog_matches)) return false;
  if (value.degraded !== undefined && value.degraded !== true) return false;
  return true;
}
