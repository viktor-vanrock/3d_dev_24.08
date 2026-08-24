/**
 * Приватные assistant threads/messages/runs — `assistant.v1` (MF-1999, поверх фактической
 * реализации MF-1997/apps/api/src/assistant + MF-2000/apps/giga/src/giga/assistant). Продюсер —
 * новый домен `apps/api/src/assistant` (owner AI, см. CODEOWNERS); консюмер — `apps/web`
 * (экран «ассистент сборки»). CRUD threads/messages/runs — cursor-пагинация (`AssistantCursorPage`),
 * идемпотентность создания через обязательный `client_request_id` в body.
 *
 * Result union (дискриминант `kind` — то же имя поля, что реально пишет
 * `apps/giga/src/giga/assistant/schemas.py::AssistantResult`, а не `type` из первоначального
 * текста решения MF-1999 — здесь контракт документирует форму, которая уже сериализуется в
 * `assistant_runs.result` jsonb, а не переизобретает имя поля). `search_results`/
 * `generation_progress` — часть контракта (будущие продюсеры, см. MF-1998/MF-2001), сегодняшний
 * `assistant-run.v1` (giga RAG-раннер) — заведомое подмножество:
 * `answer|clarification|generation_offer|error`, см. `docs/contracts/assistant.run.v1.md`
 * § «Соответствие полей».
 */

// `packages/contracts` не импортирует из apps/* (зависимость только в одну сторону — apps/api и
// apps/web зависят от @portal/contracts, не наоборот, см. apps/api/package.json). Поэтому
// GENERATION_BRANCHES/PROMPT_MAX_LENGTH/PARAMS_MAX_JSON_BYTES здесь НЕ копируются повторно —
// единственный источник истины остаётся apps/api/src/generations/contract.ts, и обе точки
// реального рантайм-использования offer'а (apps/api/src/generations/create.ts — уже сегодня;
// apps/api/src/assistant/generations.ts — при подтверждении offer'а) импортируют его оттуда
// напрямую (тот же app, без layering-нарушения). Guard ниже проверяет только форму/непустоту.
export type GenerationBranch = string;

export const ASSISTANT_CONTRACT_VERSION = "assistant.v1" as const;

export const ASSISTANT_MESSAGE_ROLES = ["user", "assistant"] as const;
export type AssistantMessageRole = (typeof ASSISTANT_MESSAGE_ROLES)[number];

export const ASSISTANT_RUN_STATUSES = ["queued", "running", "done", "error"] as const;
export type AssistantRunStatus = (typeof ASSISTANT_RUN_STATUSES)[number];

// Полный дискриминант union'а результата (§2 контракт-решения MF-1999). result_type — эхо
// result.kind на строке assistant_runs (см. isAssistantRunResult ниже) — колонка ограничена тем
// же словарём. search_results/generation_progress сегодня не эмитятся ни одним продюсером
// (giga.assistant-run.v1 — подмножество из 4), но входят в контракт, а не только в реализацию.
export const ASSISTANT_RESULT_KINDS = [
  "search_results",
  "clarification",
  "answer",
  "generation_offer",
  "generation_progress",
  "error",
] as const;
export type AssistantResultKind = (typeof ASSISTANT_RESULT_KINDS)[number];

/** Подмножество, которое реально может записать giga.assistant-run.v1 (jobs/giga.ts). */
export const ASSISTANT_RUN_RESULT_TYPES = ["answer", "clarification", "generation_offer", "error"] as const;
export type AssistantRunResultType = (typeof ASSISTANT_RUN_RESULT_TYPES)[number];

export const ASSISTANT_ERROR_CODES = [
  "provider_timeout",
  "provider_error",
  "invalid_output",
] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

export interface AssistantThread {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantMessage {
  id: string;
  thread_id: string;
  role: AssistantMessageRole;
  content: string;
  run_id: string | null;
  created_at: string;
}

/**
 * Ссылка на элемент результата поиска — тот же тип, что элемент `http/search.ts::model-search.v1`
 * (MF-2013, ещё не смёржен). До появления файла держим минимальную структурную форму здесь;
 * когда `http/search.ts` landится — это поле переключается на импорт, не копию (§2 решения).
 */
export interface AssistantSearchResultItem {
  model_id: string;
  title: string;
  relevance_rank: number;
}

export interface AssistantSearchResults {
  kind: "search_results";
  query: string;
  items: AssistantSearchResultItem[];
}

export interface AssistantClarification {
  kind: "clarification";
  /** Одно поле, не список — структурно не более одного уточнения за раз. */
  question: string;
  reason?: string | null;
}

export interface AssistantCitation {
  model_id: string;
  title: string;
  snippet: string;
  score: number;
  source_url?: string | null;
}

export interface AssistantAnswer {
  kind: "answer";
  text: string;
  citations: AssistantCitation[];
  note?: string | null;
}

/**
 * Только предложение — инертна, не запускает генерацию. `offer_id` — идентичность подтверждения
 * (`ConfirmAssistantGenerationRequest.run_id`), сегодня 1:1 с породившим run — отдельного
 * synthetic id продюсер не заводит. `prompt_summary` — то, что реально пишет
 * `AssistantGenerationOffer` (giga/assistant/schemas.py); `POST /assistant/threads/:id/generations`
 * передаёт его как `prompt` в `createGeneration` (apps/api/src/generations/create.ts), где он же
 * проходит `PROMPT_MAX_LENGTH`. `params` — опционален, giga-раннер сегодня его не заполняет
 * (default `{}`), но поле часть контракта на будущее (напр. structured branch params).
 */
export interface AssistantGenerationOffer {
  kind: "generation_offer";
  offer_id: string;
  branch: GenerationBranch;
  prompt_summary: string;
  params?: Record<string, unknown>;
  note?: string | null;
}

/** Тонкий passthrough — assistant не владеет состоянием генерации, только ссылается на неё. */
export interface AssistantGenerationProgress {
  kind: "generation_progress";
  generation_id: string;
  status: string;
}

export interface AssistantError {
  kind: "error";
  code: AssistantErrorCode;
  message: string;
  retryable?: boolean;
}

export type AssistantRunResult =
  | AssistantSearchResults
  | AssistantClarification
  | AssistantAnswer
  | AssistantGenerationOffer
  | AssistantGenerationProgress
  | AssistantError;

// Amendment к MF-1999 §2/§4 (комментарий Contract Architect на MF-1999, «run/generation progress
// snapshot + SSE»): позиция ВНУТРИ генерации, осмысленна только при status='running' и только для
// run'ов, реально идущих через генерацию (generate_3d/revise_3d) — для clarify/answer нет фазы,
// AssistantRun.progress остаётся null. Отдельная ось от status (грубый жизненный цикл run'а) и от
// верхнеуровневых queue_position/eta_seconds на AssistantRun (те — позиция во внешней очереди
// job'а целиком, до старта генерации, живой read-time расчёт из assistant/queue.ts).
//
// Правка MF-2014 (второй проход Contract Architect): queue_position убран отсюда — на AssistantRun
// это read-time позиция во внешней очереди, здесь был бы второй, потенциально расходящийся
// источник тех же данных, который писала бы другая часть воркера. eta_seconds ОСТАЁТСЯ — это не
// дубликат верхнеуровневого поля (то — только пока status='queued', это — только пока
// status='running', пересечения по времени нет), а гранулярная оценка "сколько ещё осталось" уже
// идущему пайплайну генерации; это ровно то, что реально пишет apps/giga (MF-2001,
// generations.eta_seconds — БД-колонка, apps/api/src/generations/contract.ts::generationProgress).
export const RUN_PHASES = ["queued", "loading", "draft", "geometry", "validation", "export"] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/**
 * Жёсткое правило (та же дисциплина, что search-score в §1 решения MF-1999): только сервер
 * публикует progress/eta_seconds — фронт НЕ интерполирует и не дорисовывает процент/оставшееся
 * время между снапшотами. `progress: null` — фаза без осмысленного процента (напр. `queued`);
 * `estimate_updated_at: null` — сервер ещё не публиковал оценку.
 */
export interface RunProgressSnapshot {
  phase: RunPhase;
  progress: number | null;
  eta_seconds: number | null;
  estimate_updated_at: string | null;
}

export interface AssistantRun {
  id: string;
  thread_id: string;
  triggering_message_id: string;
  status: AssistantRunStatus;
  result_type: AssistantResultKind | null;
  result: Record<string, unknown>;
  error_code: string | null;
  confirmed_generation_id: string | null;
  // Живая позиция в очереди / грубая оценка ожидания (только пока status='queued', иначе null) —
  // считается на лету из БД, не из памяти соединения, поэтому одинаково доступна и в SSE-снапшоте,
  // и в обычном поллинге после deep-link восстановления без открытого SSE (см. apps/api/src/
  // assistant/queue.ts).
  queue_position: number | null;
  eta_seconds: number | null;
  // Присутствует только пока run реально идёт через генерацию — null для clarify/answer и пока
  // генерация не началась. См. RunProgressSnapshot выше.
  progress?: RunProgressSnapshot | null;
  created_at: string;
  updated_at: string;
}

// SSE-события GET /assistant/runs/:id/events (apps/api/src/assistant/events.ts). Сегодня один
// run даёт максимум одно 'assistant.delta' (воркер MF-2000 пишет результат атомарно, не
// построково) + ровно одно терминальное событие; формат уже рассчитан на будущий построковый
// стриминг — тогда один run будет давать много 'assistant.delta' подряд, контракт не меняется.
export const ASSISTANT_RUN_EVENT_TYPES = ["assistant.delta", "assistant.completed", "assistant.error"] as const;
export type AssistantRunEventType = (typeof ASSISTANT_RUN_EVENT_TYPES)[number];

// seq — монотонный per-run счётчик, стартует с 1; это же значение отправляется как SSE `id:` и
// принимается сервером обратно в заголовке `Last-Event-ID` при reconnect (браузерный EventSource
// делает это автоматически). Сервер отдаёт только seq строго больше присланного — дублей на
// reconnect не бывает, т.к. лог append-only и seq не переиспользуется.
export interface AssistantRunEvent {
  seq: number;
  event_type: AssistantRunEventType;
  payload: Record<string, unknown>;
}

// Первое, что видит свежее (без Last-Event-ID) SSE-подключение — снапшот текущего состояния run'а,
// той же формы, что GET /assistant/threads/:id/runs/:runId (оба читателя согласованы, оба берут
// живое состояние из БД). При reconnect с Last-Event-ID снапшот не шлётся — только доигрыш
// событий с seq > Last-Event-ID.
export interface AssistantRunSnapshotEvent {
  run: AssistantRun;
}

export interface CreateAssistantThreadRequest {
  title?: string;
}

export interface CreateAssistantMessageRequest {
  content: string;
  // Идемпотентность: повтор одного client_request_id в одном thread'е не создаёт вторую
  // message/run — отдаёт уже созданную пару. Тот же ключ + другой body → 409
  // assistant_idempotency_conflict.
  client_request_id: string;
}

export interface CreateAssistantMessageResponse {
  message: AssistantMessage;
  run: AssistantRun;
}

// Подтверждение generation_offer конкретного run'а — переиспользует очередь /generations
// (apps/api/src/generations), не заводит вторую. Ответ — тот же GenerationResponse, что
// POST /generations уже отдаёт (apps/api/src/generations/contract.ts::toGenerationResponse).
export interface ConfirmAssistantGenerationRequest {
  run_id: string;
}

export const ASSISTANT_LIST_DEFAULT_LIMIT = 24;
export const ASSISTANT_MESSAGES_DEFAULT_LIMIT = 30;

export interface AssistantCursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export const ASSISTANT_ERROR_RESPONSE_CODES = [
  "unauthorized",
  "assistant_thread_not_found",
  "assistant_run_not_found",
  "assistant_idempotency_conflict",
  "assistant_rate_limited",
  "assistant_run_failed",
  "assistant_contract_version_unsupported",
] as const;
export type AssistantErrorResponseCode = (typeof ASSISTANT_ERROR_RESPONSE_CODES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

export function isAssistantSearchResults(value: unknown): value is AssistantSearchResults {
  if (!isRecord(value) || value.kind !== "search_results") return false;
  if (typeof value.query !== "string") return false;
  if (!Array.isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      typeof item.model_id === "string" &&
      typeof item.title === "string" &&
      typeof item.relevance_rank === "number",
  );
}

export function isAssistantClarification(value: unknown): value is AssistantClarification {
  if (!isRecord(value) || value.kind !== "clarification") return false;
  return typeof value.question === "string" && value.question.length > 0 && isNullableString(value.reason);
}

export function isAssistantAnswer(value: unknown): value is AssistantAnswer {
  if (!isRecord(value) || value.kind !== "answer") return false;
  if (typeof value.text !== "string") return false;
  if (!Array.isArray(value.citations)) return false;
  const citationsValid = value.citations.every(
    (c) =>
      isRecord(c) &&
      typeof c.model_id === "string" &&
      typeof c.title === "string" &&
      typeof c.snippet === "string" &&
      typeof c.score === "number" &&
      isNullableString(c.source_url),
  );
  return citationsValid && isNullableString(value.note);
}

/**
 * Только структурная форма — branch/prompt_summary/params ДЛИНЫ проверяет
 * apps/api/src/generations/contract.ts на реальном рантайм-пути (create.ts/assistant/
 * generations.ts), этот guard намеренно не дублирует те лимиты (см. комментарий у
 * `GenerationBranch` выше про layering).
 */
export function isAssistantGenerationOffer(value: unknown): value is AssistantGenerationOffer {
  if (!isRecord(value) || value.kind !== "generation_offer") return false;
  if (typeof value.offer_id !== "string" || value.offer_id.length === 0) return false;
  if (typeof value.branch !== "string" || value.branch.length === 0) return false;
  if (typeof value.prompt_summary !== "string" || value.prompt_summary.trim().length === 0) return false;
  if (value.params !== undefined && !isRecord(value.params)) return false;
  return isNullableString(value.note);
}

export function isAssistantGenerationProgress(value: unknown): value is AssistantGenerationProgress {
  if (!isRecord(value) || value.kind !== "generation_progress") return false;
  return typeof value.generation_id === "string" && typeof value.status === "string";
}

export function isAssistantError(value: unknown): value is AssistantError {
  if (!isRecord(value) || value.kind !== "error") return false;
  if (!(ASSISTANT_ERROR_CODES as readonly string[]).includes(value.code as string)) return false;
  if (typeof value.message !== "string") return false;
  return value.retryable === undefined || typeof value.retryable === "boolean";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

/**
 * Структурная форма ТОЛЬКО — не проверяет и не может проверить дисциплину «сервер не
 * интерполирует»: это свойство продюсера (нет вычисляемых/интерполированных значений между
 * снапшотами), а не что-то, что видно в форме одного снапшота. Contract test фиксирует принцип
 * через fixtures (см. assistant.test.ts) — снапшот либо содержит то, что реально пришло с
 * сервера, либо `null`, третьего (клиентского домысливания) в этом типе нет.
 */
export function isRunProgressSnapshot(value: unknown): value is RunProgressSnapshot {
  if (!isRecord(value)) return false;
  if (!(RUN_PHASES as readonly string[]).includes(value.phase as string)) return false;
  // Все три поля обязательные-но-nullable — undefined (отсутствующий ключ) не годится, это не
  // то же самое, что явный null (см. isNullableString/isNullableNumber, которые пропускают
  // undefined для действительно опциональных полей вроде note/reason выше).
  return (
    isNullableNumber(value.progress) &&
    isNullableNumber(value.eta_seconds) &&
    (value.estimate_updated_at === null || typeof value.estimate_updated_at === "string")
  );
}

export function isAssistantRunResult(value: unknown): value is AssistantRunResult {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "search_results":
      return isAssistantSearchResults(value);
    case "clarification":
      return isAssistantClarification(value);
    case "answer":
      return isAssistantAnswer(value);
    case "generation_offer":
      return isAssistantGenerationOffer(value);
    case "generation_progress":
      return isAssistantGenerationProgress(value);
    case "error":
      return isAssistantError(value);
    default:
      return false;
  }
}

export function isCreateAssistantMessageRequest(value: unknown): value is CreateAssistantMessageRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.content === "string" &&
    value.content.length > 0 &&
    typeof value.client_request_id === "string" &&
    value.client_request_id.length > 0
  );
}

export function isConfirmAssistantGenerationRequest(value: unknown): value is ConfirmAssistantGenerationRequest {
  return isRecord(value) && typeof value.run_id === "string" && value.run_id.length > 0;
}

export function isCreateAssistantThreadRequest(value: unknown): value is CreateAssistantThreadRequest {
  return isRecord(value) && isOptionalString(value.title);
}
