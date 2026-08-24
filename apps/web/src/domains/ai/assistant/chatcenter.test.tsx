import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@shared/types";
import { AssistantChatCenter } from "./chatcenter.tsx";
import { openAssistantExperience } from "./events.ts";

const user: SessionUser = {
  id: "maker-1",
  username: "maker",
  display_name: "Maker",
  avatar_url: null,
  handle_confirmed: true,
  role: "user",
};

const now = new Date().toISOString();
const thread = { id: "thread-live", title: "Привет", created_at: now, updated_at: now };
const message = { id: "message-live", thread_id: thread.id, role: "user", content: "Привет", run_id: null, created_at: now };
const queuedRun = {
  id: "run-live",
  thread_id: thread.id,
  triggering_message_id: message.id,
  status: "queued",
  result_type: null,
  result: null,
  error_code: null,
  confirmed_generation_id: null,
  queue_position: 1,
  eta_seconds: 4,
  created_at: now,
  updated_at: now,
};
const doneRun = {
  ...queuedRun,
  status: "done",
  result_type: "answer",
  result: { kind: "answer", text: "Привет! Что будем мастерить?", citations: [] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("AssistantChatCenter", () => {
  it("продолжает разговор в том же оверлее без редиректа и служебного префикса", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/assistant/threads") && method === "GET") return jsonResponse({ items: [], next_cursor: null });
      if (url.endsWith("/assistant/threads") && method === "POST") return jsonResponse({ thread });
      if (url.endsWith(`/assistant/threads/${thread.id}/messages`) && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { content: string };
        expect(body.content).toBe("Привет");
        return jsonResponse({ message, run: queuedRun });
      }
      if (url.includes(`/assistant/threads/${thread.id}/messages?`)) return jsonResponse({ items: [message], next_cursor: null });
      if (url.endsWith(`/assistant/threads/${thread.id}`)) return jsonResponse({ thread });
      if (url.includes(`/assistant/threads/${thread.id}/runs/${queuedRun.id}`)) return jsonResponse({ run: doneRun });
      return jsonResponse({}, 404);
    }));

    render(<AssistantChatCenter user={user} />);
    openAssistantExperience("Привет", { kind: "home", label: "На главной", pathname: "/", placeholder: "Спросите" });

    const composer = await screen.findByRole("textbox", { name: "Сообщение ГигаЧату" });
    expect((composer as HTMLTextAreaElement).value).toBe("Привет");
    expect(screen.queryByText("Недавние")).toBeNull();
    expect(screen.queryByRole("button", { name: /Новый чат/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Все чаты/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Баланс" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Отправить/ }));

    expect(await screen.findByText("Привет! Что будем мастерить?")).toBeTruthy();
    expect(window.location.pathname).toBe("/");
    expect(screen.getByRole("dialog", { name: "ГигаЧат — поиск и помощник" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Привет", { selector: ".assistantMessage p" })).toBeTruthy());
    expect(screen.queryByText(/\[На главной/)).toBeNull();
    expect(screen.queryByText("Чем займёмся, Valery?")).toBeNull();
  });
});
