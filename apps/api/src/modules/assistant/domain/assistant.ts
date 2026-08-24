import type { AssistantRunEvent } from "@portal/contracts/http/assistant";

export const THREAD_TITLE_MAX_LENGTH = 200;
export const MESSAGE_CONTENT_MAX_LENGTH = 4000;
export const CLIENT_REQUEST_ID_MAX_LENGTH = 200;
export const RUN_STATUSES = ["queued", "running", "done", "error"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_RESULT_TYPES = ["answer", "clarification", "generation_offer", "error"] as const;
export type RunResultType = (typeof RUN_RESULT_TYPES)[number];
export type MessageRole = "user" | "assistant";

export interface AssistantThreadRow {
  readonly id: string;
  readonly owner_id: string;
  readonly title: string | null;
  readonly kind: "chat" | "device_incident";
  readonly device_id: string | null;
  readonly severity: "info" | "warning" | "critical" | null;
  readonly incident_status: "open" | "acknowledged" | "resolved" | null;
  readonly read_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface AssistantMessageRow {
  readonly id: string;
  readonly thread_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly client_request_id: string | null;
  readonly run_id: string | null;
  readonly created_at: Date;
}

export interface AssistantRunRow {
  readonly id: string;
  readonly thread_id: string;
  readonly triggering_message_id: string;
  readonly user_id: string;
  readonly message: string;
  readonly status: RunStatus;
  readonly result_type: RunResultType | null;
  readonly result: Record<string, unknown>;
  readonly error_code: string | null;
  readonly confirmed_generation_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type AssistantRunEventRow = AssistantRunEvent;

export interface RunQueueInfo {
  readonly position: number;
  readonly eta_seconds: number;
}

export interface AssistantThreadResponse {
  readonly id: string;
  readonly title: string | null;
  readonly kind: "chat" | "device_incident";
  readonly device_id: string | null;
  readonly severity: "info" | "warning" | "critical" | null;
  readonly incident_status: "open" | "acknowledged" | "resolved" | null;
  readonly read_at: Date | null;
  readonly unread: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}
export interface AssistantMessageResponse {
  readonly id: string;
  readonly thread_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly run_id: string | null;
  readonly created_at: Date;
}
export interface AssistantCitationResponse {
  readonly model_id: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly source_url: string | null;
}
export type AssistantRunResultResponse =
  | { readonly kind: "answer"; readonly text: string; readonly citations: readonly AssistantCitationResponse[]; readonly note: string | null }
  | { readonly kind: "clarification"; readonly question: string; readonly reason: string | null }
  | { readonly kind: "generation_offer"; readonly offer_id: string; readonly branch: string | null; readonly prompt_summary: string; readonly note: string | null }
  | { readonly kind: "error"; readonly code: string; readonly retryable: boolean }
  | { readonly kind?: undefined };
export interface AssistantRunResponse {
  readonly id: string;
  readonly thread_id: string;
  readonly triggering_message_id: string;
  readonly status: RunStatus;
  readonly result_type: RunResultType | null;
  readonly result: AssistantRunResultResponse;
  readonly error_code: string | null;
  readonly confirmed_generation_id: string | null;
  readonly queue_position: number | null;
  readonly eta_seconds: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function assistantMessageQuotaHourly(): number {
  return positiveIntEnv("ASSISTANT_MESSAGE_QUOTA_HOURLY", 30);
}
export function assistantMessageQuotaDaily(): number {
  return positiveIntEnv("ASSISTANT_MESSAGE_QUOTA_DAILY", 150);
}
export function assistantRunEtaSecondsPerJob(): number {
  return positiveIntEnv("ASSISTANT_RUN_ETA_SECONDS_PER_JOB", 20);
}
export function assistantRunStaleTimeoutMinutes(): number {
  return positiveIntEnv("ASSISTANT_RUN_STALE_TIMEOUT_MINUTES", 15);
}
export function assistantRunSsePollMs(): number {
  return positiveIntEnv("ASSISTANT_RUN_SSE_POLL_MS", 1000);
}
export function assistantThreadSsePollMs(): number {
  return positiveIntEnv("ASSISTANT_THREAD_SSE_POLL_MS", 1500);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseLimit(raw: unknown, fallback: number, maximum: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

export function deriveResultKind(row: AssistantRunRow): RunResultType | null {
  const kind = (row.result as { readonly kind?: unknown } | null)?.kind;
  return typeof kind === "string" && (RUN_RESULT_TYPES as readonly string[]).includes(kind) ? (kind as RunResultType) : row.result_type;
}

export function deriveErrorCode(row: AssistantRunRow): string | null {
  return row.error_code ?? (row.status === "error" ? "provider_error" : null);
}

function sanitizeCitation(raw: unknown): AssistantCitationResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.model_id !== "string" || typeof value.title !== "string" || typeof value.snippet !== "string") return null;
  return {
    model_id: value.model_id,
    title: value.title,
    snippet: value.snippet,
    score: typeof value.score === "number" ? value.score : 0,
    source_url: typeof value.source_url === "string" ? value.source_url : null,
  };
}

export function sanitizeRunResult(result: unknown, kind: RunResultType | null, runId: string): AssistantRunResultResponse {
  if (kind === null || typeof result !== "object" || result === null) return {};
  const value = result as Record<string, unknown>;
  switch (kind) {
    case "answer":
      return {
        kind,
        text: typeof value.text === "string" ? value.text : "",
        citations: Array.isArray(value.citations) ? value.citations.map(sanitizeCitation).filter((item) => item !== null) : [],
        note: typeof value.note === "string" ? value.note : null,
      };
    case "clarification":
      return { kind, question: typeof value.question === "string" ? value.question : "", reason: typeof value.reason === "string" ? value.reason : null };
    case "generation_offer":
      return {
        kind,
        offer_id: typeof value.offer_id === "string" && value.offer_id.length > 0 ? value.offer_id : runId,
        branch: typeof value.branch === "string" ? value.branch : null,
        prompt_summary: typeof value.prompt_summary === "string" ? value.prompt_summary : typeof value.prompt === "string" ? value.prompt : "",
        note: typeof value.note === "string" ? value.note : null,
      };
    case "error":
      return { kind, code: typeof value.code === "string" ? value.code : "provider_error", retryable: typeof value.retryable === "boolean" ? value.retryable : true };
  }
}

export function toThreadResponse(row: AssistantThreadRow): AssistantThreadResponse {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    device_id: row.device_id,
    severity: row.severity,
    incident_status: row.incident_status,
    read_at: row.read_at,
    unread: row.kind === "device_incident" && row.read_at === null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toMessageResponse(row: AssistantMessageRow): AssistantMessageResponse {
  return { id: row.id, thread_id: row.thread_id, role: row.role, content: row.content, run_id: row.run_id, created_at: row.created_at };
}

export function toRunResponse(row: AssistantRunRow, queue: RunQueueInfo | null = null): AssistantRunResponse {
  const kind = deriveResultKind(row);
  return {
    id: row.id,
    thread_id: row.thread_id,
    triggering_message_id: row.triggering_message_id,
    status: row.status,
    result_type: kind,
    result: sanitizeRunResult(row.result, kind, row.id),
    error_code: deriveErrorCode(row),
    confirmed_generation_id: row.confirmed_generation_id,
    queue_position: queue?.position ?? null,
    eta_seconds: queue?.eta_seconds ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toRunSseFrame(row: AssistantRunEventRow): string {
  return `id: ${row.seq}\nevent: ${row.event_type}\ndata: ${JSON.stringify(row.payload)}\n\n`;
}

export function toThreadSseFrame(row: { readonly seq: number; readonly event_type: string; readonly payload: Record<string, unknown> }): string {
  return `id: ${row.seq}\nevent: ${row.event_type}\ndata: ${JSON.stringify(row.payload)}\n\n`;
}
