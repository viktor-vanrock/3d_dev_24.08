// Клиент реального assistant.v1 API (MF-1997/MF-1999, packages/contracts/http/assistant.ts) —
// заменяет localassistant.ts (localStorage-фикстуру, MF-1996 fixture-first). Тот же паттерн
// fetch/credentials, что generate/generations.ts и auth/session.ts.

import type { Generation } from "../generate/generations.ts";
import { apiFetch } from "@shared/api";
import type { components } from "src/api/generated/openapi";

function makeClientRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `cr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function createThread(title?: string): Promise<components["schemas"]["AssistantThreadDto"] | null> {
  try {
    const response = await apiFetch(`/assistant/threads`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantThreadResponseDto"];
    return body.thread;
  } catch {
    return null;
  }
}

export async function getThread(id: string): Promise<components["schemas"]["AssistantThreadDto"] | null> {
  try {
    const response = await apiFetch(`/assistant/threads/${encodeURIComponent(id)}`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantThreadResponseDto"];
    return body.thread;
  } catch {
    return null;
  }
}

export async function listThreads(): Promise<components["schemas"]["AssistantThreadDto"][] | null> {
  try {
    const response = await apiFetch(`/assistant/threads`, { credentials: "include" });
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantThreadsResponseDto"];
    return [...body.items];
  } catch {
    return null;
  }
}

export async function listMessages(threadId: string): Promise<components["schemas"]["AssistantMessageDto"][] | null> {
  try {
    const response = await apiFetch(
      `/assistant/threads/${encodeURIComponent(threadId)}/messages?limit=100`,
      { credentials: "include" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantMessagesResponseDto"];
    return [...body.items];
  } catch {
    return null;
  }
}

export type SendMessageResult =
  | { message: components["schemas"]["AssistantMessageDto"]; run: components["schemas"]["AssistantRunDto"] | null }
  | { error: string };

export async function sendMessage(threadId: string, content: string): Promise<SendMessageResult> {
  let response: Response;
  try {
    response = await apiFetch(`/assistant/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, client_request_id: makeClientRequestId() }),
    });
  } catch {
    return { error: "NETWORK" };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error ?? "NETWORK" };
  }
  const body = (await response.json()) as components["schemas"]["AssistantMessageCreatedResponseDto"];
  return { message: body.message, run: body.run };
}

export async function getRun(threadId: string, runId: string): Promise<components["schemas"]["AssistantRunDto"] | null> {
  try {
    const response = await apiFetch(
      `/assistant/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`,
      { credentials: "include" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as components["schemas"]["AssistantRunResponseDto"];
    return body.run;
  } catch {
    return null;
  }
}

export type ConfirmGenerationResult = { generation: Generation } | { error: string };

export async function confirmGeneration(threadId: string, runId: string): Promise<ConfirmGenerationResult> {
  let response: Response;
  try {
    response = await apiFetch(`/assistant/threads/${encodeURIComponent(threadId)}/generations`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
    });
  } catch {
    return { error: "NETWORK" };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error ?? "NETWORK" };
  }
  const body = (await response.json()) as { generation: Generation };
  return { generation: body.generation };
}

// Хендофф run_id между экраном, который создал тред+первое сообщение (home.search.tsx,
// auth/guestresume.tsx), и AssistantWorkshopScreen, который монтируется заново уже после
// навигации и не может получить run из ответа fetch напрямую (нет server state/props для этого).
// sessionStorage переживает навигацию в той же вкладке, но не более — намеренно: это подсказка
// "только что созданный run", не постоянное хранилище истории (та приходит из API).
const PENDING_RUN_PREFIX = "portal.assistant.pending-run.";

export function stashPendingRun(threadId: string, runId: string): void {
  try {
    window.sessionStorage.setItem(PENDING_RUN_PREFIX + threadId, runId);
  } catch {
    // Safari private mode/quota — просто не покажем мгновенный ответ на первый вопрос,
    // следующий poll всё равно подхватит run при первой перезагрузке экрана.
  }
}

export function takePendingRun(threadId: string): string | null {
  try {
    const key = PENDING_RUN_PREFIX + threadId;
    const value = window.sessionStorage.getItem(key);
    if (value) window.sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}