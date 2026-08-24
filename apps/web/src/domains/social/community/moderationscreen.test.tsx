import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModerationScreen } from "./moderationscreen.tsx";

vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header /> }));
vi.mock("@shared/ui/aurorabg.tsx", () => ({ AuroraBackground: () => null }));

const user = { id: "moderator-1", username: "moderator", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

const queueItem = {
  id: "flag-1",
  target: { type: "post" as const, id: "post-1" },
  reason_code: "spam_or_fraud",
  status: "open" as const,
  created_at: "2026-07-15T10:00:00Z",
};

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ModerationScreen (MF-416)", () => {
  it("запрашивает причину решения, затем применяет действие и только по ответу предлагает отмену", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/moderation/queue?status=open")) return response({ items: [queueItem], next_cursor: null });
      if (path.endsWith("/restrictions")) return response({ restrictions: [] });
      if (path.endsWith("/flags/flag-1/claim")) return response({ flag: { id: "flag-1", status: "in_review", updated_at: "2026-07-15T10:01:00Z" } });
      if (path.endsWith("/flags/flag-1/decision")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ action_type: "hide", reason_code: "spam_or_fraud" });
        return response({ action: { id: "action-1", type: "hide", status: "applied" }, flag: { id: "flag-1", status: "actioned" } }, 201);
      }
      if (path.endsWith("/moderation/actions/action-1/reversal")) {
        expect(JSON.parse(String(init?.body))).toEqual({ reason: "Контекст проверен повторно" });
        return response({ id: "action-1", status: "reversed" });
      }
      return response({ error: { code: "unexpected" } }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    const interaction = userEvent.setup();

    render(<ModerationScreen user={user} section="home" onSectionChange={() => {}} />);

    expect(await screen.findByRole("heading", { name: "Очередь модерации", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Спам или мошенничество", level: 2 })).toBeTruthy();

    await interaction.click(screen.getByRole("button", { name: "Взять в работу" }));
    const hideButton = screen.getByRole("button", { name: "Скрыть" });
    expect((hideButton as HTMLButtonElement).disabled).toBe(true);

    await interaction.selectOptions(screen.getByLabelText("Причина решения"), "spam_or_fraud");
    await interaction.type(screen.getByLabelText("Пояснение для журнала модерации"), "Рекламные ссылки повторяются");
    expect((hideButton as HTMLButtonElement).disabled).toBe(false);

    await interaction.click(hideButton);
    expect(await screen.findByText("Решение применено. Оно попадёт в журнал модерации.")).toBeTruthy();

    await interaction.click(screen.getByRole("button", { name: "Отменить" }));
    await interaction.type(screen.getByLabelText("Причина отмены"), "Контекст проверен повторно");
    await interaction.click(screen.getByRole("button", { name: "Подтвердить отмену" }));

    expect(await screen.findByText("Решение отменено. История модерации сохранена.")).toBeTruthy();
  });

  it("объясняет TL0 по серверным restrictions и времени повтора, не подставляя локальный лимит", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/moderation/queue?status=open")) return response({ items: [], next_cursor: null });
        return response({
          restrictions: [
            { action: "Публикации", remaining: 1, reset_at: "2026-07-16T08:30:00Z" },
            { action: "Личные сообщения" },
          ],
        });
      }),
    );

    render(<ModerationScreen user={user} section="home" onSectionChange={() => {}} />);

    expect(await screen.findByText(/Новый аккаунт: часть действий пока ограничена/)).toBeTruthy();
    expect(screen.getByText("Публикации: осталось 1 действие")).toBeTruthy();
    expect(screen.getByText(/Следующая попытка:/)).toBeTruthy();
    expect(screen.getByText("Личные сообщения: действие пока ограничено")).toBeTruthy();
  });

  it("не маскирует запрет на очередь под пустое состояние", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/moderation/queue?status=open")) return response({ error: { code: "FORBIDDEN" } }, 403);
        return response({ restrictions: [] });
      }),
    );

    render(<ModerationScreen user={user} section="home" onSectionChange={() => {}} />);

    expect((await screen.findByRole("alert")).textContent).toContain("У вас нет доступа к очереди модерации.");
    expect(screen.queryByText("В очереди нет материалов для проверки.")).toBeNull();
  });
});
