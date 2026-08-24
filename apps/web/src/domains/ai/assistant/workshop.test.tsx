import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@shared/types";
import { stashPendingRun } from "./assistantapi.ts";
import { AssistantWorkshopScreen } from "./workshop.tsx";

const user: SessionUser = {
  id: "maker-queue",
  username: "maker",
  display_name: "Maker",
  avatar_url: null,
  handle_confirmed: true,
  role: "user",
};

const THREAD_ID = "thread-1";
const RUN_ID = "run-1";
const MESSAGE_ID = "message-1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function baseThread() {
  return { id: THREAD_ID, title: "органайзер для свёрл", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

function baseMessages() {
  return {
    items: [
      { id: MESSAGE_ID, thread_id: THREAD_ID, role: "user", content: "органайзер для свёрл", run_id: null, created_at: new Date().toISOString() },
    ],
    next_cursor: null,
  };
}

function doneOfferRun(generationId: string) {
  return {
    id: RUN_ID,
    thread_id: THREAD_ID,
    triggering_message_id: MESSAGE_ID,
    status: "done",
    result_type: "generation_offer",
    result: { kind: "generation_offer", offer_id: RUN_ID, branch: "openscad", prompt_summary: "органайзер для свёрл" },
    error_code: null,
    confirmed_generation_id: generationId,
    queue_position: null,
    eta_seconds: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  document.body.classList.remove("assistantWorkspaceMounted");
  vi.restoreAllMocks();
});

describe("AssistantWorkshopScreen wait states", () => {
  it("показывает позицию и ETA из job-контракта", async () => {
    stashPendingRun(THREAD_ID, RUN_ID);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/assistant/threads/thread-1/runs/")) return jsonResponse({ run: doneOfferRun("generation-1") });
        if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages());
        if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
        if (url.includes("/generations/generation-1")) {
          return jsonResponse({
            generation: {
              id: "generation-1",
              branch: "openscad",
              prompt: "органайзер для свёрл",
              params: {},
              status: "queued",
              preview_url: null,
              artifact_url: null,
              error: null,
              error_code: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              queue_position: 3,
              eta_seconds: 170,
            },
          });
        }
        return jsonResponse({}, 404);
      }),
    );

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);

    expect(await screen.findByRole("heading", { name: "Ваш запрос в очереди" })).toBeTruthy();
    expect(screen.getByText("Перед вами 2. Как только освободится генератор, работа начнётся автоматически.")).toBeTruthy();
    expect(screen.getByText("Примерно через 3 минуты")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Прогресс генерации" })).toBeTruthy();
  });

  it("не теряет задачу при временной сетевой ошибке генерации", async () => {
    stashPendingRun(THREAD_ID, RUN_ID);
    let generationCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/assistant/threads/thread-1/runs/")) return jsonResponse({ run: doneOfferRun("generation-offline") });
        if (url.includes("/assistant/threads/thread-1/messages")) return jsonResponse(baseMessages());
        if (url.includes("/assistant/threads/thread-1")) return jsonResponse({ thread: baseThread() });
        if (url.includes("/generations/generation-offline")) {
          generationCalls += 1;
          if (generationCalls === 1) {
            return jsonResponse({
              generation: {
                id: "generation-offline",
                branch: "openscad",
                prompt: "держатель",
                params: {},
                status: "queued",
                preview_url: null,
                artifact_url: null,
                error: null,
                error_code: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            });
          }
          throw new Error("offline");
        }
        return jsonResponse({}, 404);
      }),
    );

    render(<AssistantWorkshopScreen user={user} threadId={THREAD_ID} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Связь прервалась — задача не потеряна" })).toBeTruthy();
    });
    expect(screen.getByText("Продолжаем проверять в фоне. Можно закрыть мастерскую и вернуться из раздела «Чаты».")).toBeTruthy();
  });
});
