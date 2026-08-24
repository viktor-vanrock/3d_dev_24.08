import type { Request } from "express";
import type { QueryResult, QueryResultRow } from "pg";
import type { AssistantSearchResultItem } from "@portal/contracts/http/assistant";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { GenerationOutcome, GenerationResponse } from "../../generations/public/index.ts";
import type { AssistantMessageResponse, AssistantRunResponse, AssistantThreadResponse } from "../domain/assistant.ts";

export const ASSISTANT_PORT = Symbol("ASSISTANT_PORT");
export const ASSISTANT_EXTERNAL_PORT = Symbol("ASSISTANT_EXTERNAL_PORT");
export const ASSISTANT_GENERATIONS_PORT = Symbol("ASSISTANT_GENERATIONS_PORT");
export const ASSISTANT_INCIDENT_PORT = Symbol("ASSISTANT_INCIDENT_PORT");

export interface AssistantQueryExecutor {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

export interface AssistantIncidentPort {
  transitionIncidentThread(executor: AssistantQueryExecutor, input: { readonly threadId: string; readonly status: "acknowledged" | "resolved" }): Promise<void>;
}

export interface AssistantEventStream {
  readonly frames: AsyncIterable<string>;
}

export interface AssistantPromptVariantsResponse {
  readonly contract_version: "assistant.prompt-variants.v1";
  readonly request_id: string;
  readonly intent: { readonly normalized_query: string; readonly motif: string | null };
  readonly variants: readonly (AssistantPromptVariant & { readonly id: string })[];
  readonly catalog_matches: readonly AssistantCatalogMatch[];
  readonly degraded?: true;
}

export interface AssistantPort {
  createThread(userId: UserId, title: unknown): Promise<{ readonly thread: AssistantThreadResponse }>;
  listThreads(userId: UserId, query: Readonly<Record<string, unknown>>): Promise<{ readonly items: readonly AssistantThreadResponse[]; readonly next_cursor: string | null }>;
  threadDetail(userId: UserId, threadId: string): Promise<{ readonly thread: AssistantThreadResponse }>;
  markThreadRead(userId: UserId, threadId: string): Promise<{ readonly thread: AssistantThreadResponse }>;
  openThreadEvents(userId: UserId, threadId: string, lastEventId: unknown, signal: AbortSignal): Promise<AssistantEventStream>;
  listMessages(
    userId: UserId,
    threadId: string,
    query: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly items: readonly AssistantMessageResponse[]; readonly next_cursor: string | null }>;
  createMessage(
    userId: UserId,
    threadId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly status: number; readonly body: { readonly message: AssistantMessageResponse; readonly run: AssistantRunResponse | null } }>;
  runDetail(userId: UserId, threadId: string, runId: string): Promise<{ readonly run: AssistantRunResponse }>;
  openRunEvents(userId: UserId, runId: string, lastEventId: unknown, signal: AbortSignal): Promise<AssistantEventStream>;
  confirmGeneration(userId: UserId, threadId: string, runId: unknown): Promise<GenerationOutcome>;
  promptVariants(userId: UserId, body: Readonly<Record<string, unknown>>, request: Request): Promise<AssistantPromptVariantsResponse>;
}

export type AssistantCatalogMatch = AssistantSearchResultItem;

export interface AssistantThreadEvent {
  readonly seq: number;
  readonly event_type: string;
  readonly payload: Record<string, unknown>;
}

export interface AssistantPromptVariant {
  readonly label: string;
  readonly prompt: string;
  readonly motif: string | null;
  readonly confidence: number;
}

export interface AssistantPromptDraft {
  readonly normalized_query: string;
  readonly motif: string | null;
  readonly variants: readonly AssistantPromptVariant[];
}

export type AssistantPromptResult = { readonly ok: true; readonly draft: AssistantPromptDraft } | { readonly ok: false; readonly status: number; readonly error: string };

export interface AssistantExternalPort {
  assertPromptVariantsRateLimit(request: Request, userId: UserId): Promise<void>;
  isPromptBlocked(prompt: string): boolean;
  searchCatalogMatches(query: string): Promise<readonly AssistantCatalogMatch[]>;
  requestPromptVariants(query: string, limit: number, batch: number, excludeLabels: readonly string[]): Promise<AssistantPromptResult>;
  loadThreadEventsAfter(threadId: string, afterSeq: number): Promise<readonly AssistantThreadEvent[]>;
}

export interface AssistantGenerationsPort {
  create(userId: UserId, body: Readonly<Record<string, unknown>>): Promise<GenerationOutcome>;
  detail(userId: UserId, generationId: string): Promise<{ readonly generation: GenerationResponse }>;
}
export { requestPromptVariants } from "../infrastructure/prompt-variants-giga.client.ts";
