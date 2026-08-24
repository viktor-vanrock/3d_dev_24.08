import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomeScreen } from "./home.tsx";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";

// Сквозной прогон first-run флоу (MF-437: персона → «есть ли принтер?» → picker → чек-лист),
// нажимая только реальные кнопки — так же, как «сквозной проход, нажимая только «пропустить»,
// доводит до гостевого дома» проверяется в эпике MF-435. Мокаем только сеть (fetch), не логику.

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function activationPayload(overrides: Record<string, unknown> = {}) {
  return {
    activation: {
      state: "first_run",
      has_printer: false,
      primary_persona: null,
      home_tier: "auto",
      activation_checklist: {},
      home_dismissed_prompts: {},
      ...overrides,
    },
    printers: [],
    filaments: [],
  };
}

function mockFetch(activation: ReturnType<typeof activationPayload>) {
  let current = activation;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/me/activation") && (!init || init.method === undefined)) {
        return new Response(JSON.stringify(current), { status: 200 });
      }
      if (url.includes("/me/activation") && init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body));
        // Реплика поведения apps/api/src/profile/activation.ts: first_run_completed=true
        // переводит state в returning (не отдельное поле в Activation на клиенте).
        const state = patch.first_run_completed === true ? "returning" : current.activation.state;
        current = {
          ...current,
          activation: {
            ...current.activation,
            ...patch,
            state,
            home_dismissed_prompts: { ...current.activation.home_dismissed_prompts, ...patch.home_dismissed_prompts },
            activation_checklist: { ...current.activation.activation_checklist, ...patch.activation_checklist },
          },
        };
        return new Response(JSON.stringify({ activation: current.activation }), { status: 200 });
      }
      if (url.includes("/machines")) {
        return new Response(JSON.stringify({ machines: [] }), { status: 200 });
      }
      if (url.includes("/materials")) {
        return new Response(JSON.stringify({ materials: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }),
  );
  return () => current;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHome() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <HomeScreen user={user} section="home" onSectionChange={() => {}} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("first-run флоу — сквозной проход", () => {
  it("персона → вопрос про принтер → «Пропустить» → soft-track → чек-лист, без пустых экранов", async () => {
    mockFetch(activationPayload());
    renderHome();

    expect(await screen.findByText(/Что вас сюда привело/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Подключить принтер" })).toBeNull();
    fireEvent.click(screen.getByText("У меня есть принтер"));

    expect(await screen.findByText("У вас уже есть 3D-принтер?")).toBeTruthy();
    fireEvent.click(screen.getByText("Пропустить"));

    expect(await screen.findByText(/Ничего страшного/)).toBeTruthy();
    fireEvent.click(screen.getByText("Продолжить без принтера"));

    expect(await screen.findByText("Первые шаги")).toBeTruthy();
    // Ничего не блокирует: поиск и галерея уже на экране на каждом шаге флоу.
    expect(screen.getByPlaceholderText("Найти или создать модель")).toBeTruthy();
  });

  it("персона → «Да» → picker «Позже» → филамент «Пропустить» → чек-лист", async () => {
    mockFetch(activationPayload());
    renderHome();

    fireEvent.click(await screen.findByText("У меня есть принтер"));
    fireEvent.click(await screen.findByText("Да"));

    expect(await screen.findByText("Какой у вас принтер?")).toBeTruthy();
    fireEvent.click(screen.getByText("Позже"));

    expect(await screen.findByText("Каким пластиком печатаете?")).toBeTruthy();
    fireEvent.click(screen.getByText("Пропустить"));

    expect(await screen.findByText("Первые шаги")).toBeTruthy();
  });

  it("«просто посмотреть» пропускает весь флоу без штрафа → гостевой дом сразу", async () => {
    mockFetch(activationPayload());
    renderHome();

    expect(await screen.findByText(/Что вас сюда привело/)).toBeTruthy();
    fireEvent.click(screen.getByText("Пропустить"));

    await waitFor(() => expect(screen.queryByText(/Что вас сюда привело/)).toBeNull());
  });
});
