// Шов `jobs/giga` — обе стороны AI, но `apps/api` и `apps/giga` разные рантаймы/деплои (разные
// DATABASE_URL-подключения, см. комментарий в apps/api/src/generations/contract.ts), шов всё
// равно обязателен (MF-1999 §4). Только тип/схема — никакой бизнес-логики.

import {
  ASSISTANT_RUN_RESULT_TYPES,
  type AssistantRunResult,
  type AssistantRunResultType,
  isAssistantRunResult,
  isRunProgressSnapshot,
  type RunProgressSnapshot,
} from "../http/assistant.js";

// --- assistant-run.v1 -------------------------------------------------------------------------
//
// Продюсер — apps/api/src/assistant (создание run на POST .../messages), консюмер —
// apps/giga/src/giga/assistant (worker.py claim → router.route_message → db.mark_done). Очередь —
// таблица `assistant_runs` (apps/api/db/migrations/20260720120000_assistant_threads.sql),
// lease+heartbeat+attempts (не разовый claim, как generation.v2 ниже — HYPERPC-вызов может занять
// секунды-десятки секунд, воркер может упасть посреди обработки).

export const ASSISTANT_RUN_JOB_CONTRACT_VERSION = "assistant-run.v1" as const;

export interface AssistantRunV1QueueJob {
  readonly queue: typeof ASSISTANT_RUN_JOB_CONTRACT_VERSION;
  readonly runId: string;
  readonly threadId: string;
  readonly triggeringMessageId: string;
  readonly accountId: string;
  readonly message: string;
}

export interface AssistantRunJobPayload {
  contract_version: typeof ASSISTANT_RUN_JOB_CONTRACT_VERSION;
  thread_id: string;
  run_id: string;
  account_id: string;
  message: string;
  context?: {
    model_id?: string;
  };
}

/**
 * `result` — ТОТ ЖЕ union-тип, что `http/assistant.ts::AssistantRunResult` (импорт, не копия):
 * apps/api прокидывает job result напрямую в HTTP-ответ (`assistant_runs.result` jsonb), без
 * слоя трансляции и риска расхождения. `result_type` — эхо `result.kind`, ограничено
 * подмножеством, которое реально может произвести giga.assistant-run.v1 (см.
 * `ASSISTANT_RUN_RESULT_TYPES` в http/assistant.ts — сегодня answer/clarification/
 * generation_offer/error, без search_results/generation_progress).
 */
export interface AssistantRunJobResult {
  contract_version: typeof ASSISTANT_RUN_JOB_CONTRACT_VERSION;
  thread_id: string;
  run_id: string;
  result_type: AssistantRunResultType;
  result: AssistantRunResult;
}

export const ASSISTANT_RUN_JOB_ERROR_CODES = ["assistant_run_failed"] as const;
export type AssistantRunJobErrorCode = (typeof ASSISTANT_RUN_JOB_ERROR_CODES)[number];

// --- generation.v2 -----------------------------------------------------------------------------
//
// Формализует сегодняшнюю неявную форму строки `generations` (apps/giga/src/giga/worker.py:
// queued|running|done|error) в явную версию: аддитивно добавляет `contract_version` и
// `assistant_offer_id` (аудит-связка из generation_offer, apps/api/src/generations/contract.ts —
// GenerationRow.assistant_offer_id, миграция добавляющая колонку — apps/api/db/migrations/
// *_generation_assistant_offer_id.sql). Существующие поля не меняются — сегодняшний воркер,
// читающий сырые колонки, продолжает работать. Публичный `GET /generations`
// (toGenerationResponse) этим бампом НЕ тронут — assistant_offer_id туда не добавляется, это
// внутренний job/аудит-контракт, не публичный ответ.

export const GENERATION_JOB_CONTRACT_VERSION = "generation.v2" as const;

export const GENERATION_JOB_BRANCHES = ["openscad", "kzd", "hueforge", "trellis", "concepts", "scan"] as const;
export type GenerationJobBranch = (typeof GENERATION_JOB_BRANCHES)[number];
export type GenerationJobParameterValue =
  | string
  | number
  | boolean
  | null
  | readonly GenerationJobParameterValue[]
  | GenerationJobParameters;
export interface GenerationJobParameters {
  readonly [key: string]: GenerationJobParameterValue;
}

export interface GenerationV2QueueJob {
  readonly queue: typeof GENERATION_JOB_CONTRACT_VERSION;
  readonly generationId: string;
  readonly accountId: string;
  readonly branch: GenerationJobBranch;
  readonly prompt: string;
  readonly params: GenerationJobParameters;
  readonly assistantOfferId: string | null;
  readonly sourceGenerationId: string | null;
  readonly sourceAngles: readonly ("front" | "three_quarter" | "back")[] | null;
}

// timed_out — MF-2001 (apps/api/src/generations/stale.ts): честный отдельный статус вместо
// status='error'+error='generation_timeout'. Аддитивно: ассистентский assistant-run.v1 (выше)
// таймаут кодирует иначе (status='error'+error_code='timeout') — эта ветка union'а специфична
// generation.v2, не переиспользуется.
export const GENERATION_JOB_STATUSES = ["queued", "running", "done", "error", "timed_out"] as const;
export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];

// packages/contracts не импортирует apps/* (см. http/assistant.ts комментарий у GenerationBranch)
// — branch/error здесь остаются широкими string, реальный словарь и лимиты —
// apps/api/src/generations/contract.ts (GENERATION_BRANCHES/GENERATION_TIMEOUT_ERROR).
export interface GenerationJobRow {
  contract_version: typeof GENERATION_JOB_CONTRACT_VERSION;
  id: string;
  user_id: string;
  branch: GenerationJobBranch;
  prompt: string;
  params: GenerationJobParameters;
  status: GenerationJobStatus;
  artifact_url: string | null;
  preview_url: string | null;
  error: string | null;
  /** null — генерация создана не через assistant_offer (обычный прямой POST /generations). */
  assistant_offer_id: string | null;
  // Amendment к MF-1999 §2/§4 (Contract Architect, «run/generation progress snapshot + SSE») —
  // ТОТ ЖЕ тип, что AssistantRun.progress (http/assistant.ts::RunProgressSnapshot), не копия:
  // воркер (сегодня apps/giga, далее TRELLIS-джоба MF-2001) публикует снапшот сюда, api копирует
  // 1:1 в AssistantRun.progress — без трансляции/домысливания на стороне api. Аддитивно, только
  // пока status='running' и джоба реально идёт через генерацию; иначе null/отсутствует.
  progress?: RunProgressSnapshot | null;
  created_at: string;
  updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAssistantRunJobPayload(value: unknown): value is AssistantRunJobPayload {
  if (!isRecord(value)) return false;
  if (value.contract_version !== ASSISTANT_RUN_JOB_CONTRACT_VERSION) return false;
  if (typeof value.thread_id !== "string" || typeof value.run_id !== "string") return false;
  if (typeof value.account_id !== "string" || typeof value.message !== "string") return false;
  if (value.context !== undefined) {
    if (!isRecord(value.context)) return false;
    if (value.context.model_id !== undefined && typeof value.context.model_id !== "string") return false;
  }
  return true;
}

export function isAssistantRunJobResult(value: unknown): value is AssistantRunJobResult {
  if (!isRecord(value)) return false;
  if (value.contract_version !== ASSISTANT_RUN_JOB_CONTRACT_VERSION) return false;
  if (typeof value.thread_id !== "string" || typeof value.run_id !== "string") return false;
  if (!(ASSISTANT_RUN_RESULT_TYPES as readonly string[]).includes(value.result_type as string)) return false;
  if (!isAssistantRunResult(value.result)) return false;
  return isRecord(value.result) && value.result.kind === value.result_type;
}

export function isGenerationJobRow(value: unknown): value is GenerationJobRow {
  if (!isRecord(value)) return false;
  if (value.contract_version !== GENERATION_JOB_CONTRACT_VERSION) return false;
  if (typeof value.id !== "string" || typeof value.user_id !== "string") return false;
  if (typeof value.branch !== "string" || typeof value.prompt !== "string") return false;
  if (!isRecord(value.params)) return false;
  if (!(GENERATION_JOB_STATUSES as readonly string[]).includes(value.status as string)) return false;
  if (value.artifact_url !== null && typeof value.artifact_url !== "string") return false;
  if (value.preview_url !== null && typeof value.preview_url !== "string") return false;
  if (value.error !== null && typeof value.error !== "string") return false;
  if (value.assistant_offer_id !== null && typeof value.assistant_offer_id !== "string") return false;
  if (value.progress !== undefined && value.progress !== null && !isRunProgressSnapshot(value.progress)) return false;
  return true;
}
