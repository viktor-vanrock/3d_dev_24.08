import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@platform/theme";
import { HandleOnboarding } from "./onboarding.tsx";
import type { SessionUser } from "./session.ts";

// Экран выбора хендла (MF-355, Фаза 2): username предзаполнен автосгенерированным ником,
// форма шлёт PATCH /me и различает ответы бэкенда (200 → reload, 409 → «занят», 400 → формат).

const user: SessionUser = { id: "u1", username: "user7", display_name: null, avatar_url: null, handle_confirmed: false, role: "user" as const };

function mockPatch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HandleOnboarding", () => {
  it("использует единый термин «Логин» и отделяет приветствие от заголовка", () => {
    render(
      <ThemeProvider>
        <HandleOnboarding user={user} />
      </ThemeProvider>,
    );

    expect(screen.getByText("Добро пожаловать").closest("h1")).toBeNull();
    expect(screen.getByRole("heading", { name: "Выберите логин", level: 1 })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Логин" }) as HTMLInputElement).value).toBe("user7");
    expect(screen.queryByText(/@ник|Имя пользователя|свой ник/i)).toBeNull();
  });

  it("показывает подсказку про занятый логин (409 username_taken)", async () => {
    const visitor = userEvent.setup();
    mockPatch(409, { error: "username_taken" });
    render(
      <ThemeProvider>
        <HandleOnboarding user={user} />
      </ThemeProvider>,
    );
    await visitor.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(await screen.findByText(/логин уже занят/i)).toBeTruthy();
  });

  it("блокирует отправку при невалидном формате логина (короче 3 символов)", async () => {
    const visitor = userEvent.setup();
    render(
      <ThemeProvider>
        <HandleOnboarding user={user} />
      </ThemeProvider>,
    );
    const login = screen.getByRole("textbox", { name: "Логин" });
    await visitor.clear(login);
    await visitor.type(login, "ab");
    expect((screen.getByRole("button", { name: "Продолжить" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("сохраняет естественную клавиатурную последовательность полей и кнопки", async () => {
    const visitor = userEvent.setup();
    render(
      <ThemeProvider>
        <HandleOnboarding user={user} />
      </ThemeProvider>,
    );

    screen.getByRole("textbox", { name: "Логин" }).focus();
    await visitor.tab();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Имя (необязательно)" }));
    await visitor.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Продолжить" }));
  });
});
