import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import version from "../../../version.json";
import { App } from "./app.tsx";
import { Footer } from "./footer/footer.tsx";
import { HomeScreen } from "./pages/home/home.tsx";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function mockFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(routes).find((key) => url.includes(key));
    if (!match) return new Response(null, { status: 404 });
    return new Response(JSON.stringify(routes[match]), { status: 200 });
  });
  vi.stubGlobal(
    "fetch",
    fetchMock,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("app", () => {
  // MF-850/MF-912: `/` — публичный роут, гость видит главную (не редирект на вход).
  it("гость на `/` (fetch недоступен/падает → сессия guest) видит главную, не экран входа", async () => {
    render(<App />);
    expect(await screen.findByPlaceholderText("Найти или создать модель")).toBeTruthy();
    expect(screen.queryByText("PlagID")).toBeNull();
  });

  // `/generate` не в списке публичных роутов (только `/`, `/project`, `/project/:id`, `/feed`) —
  // гость там по-прежнему видит экран входа, не контент.
  it("гость на закрытом роуте (/generate) видит экран входа", async () => {
    window.history.pushState(null, "", "/generate");
    render(<App />);
    expect(await screen.findByText("PlagID")).toBeTruthy();
    window.history.pushState(null, "", "/");
  });

  it("гость на /park/add остаётся в мастере даже при закрытом dev-контуре", async () => {
    vi.stubEnv("VITE_CLOSED_DEV", "1");
    mockFetch({ "/auth/session": null });
    window.history.pushState(null, "", "/park/add?printer_id=machine-1&return_to=%2Fprinters%2Fmachine-1");

    render(<App />);

    expect(await screen.findByRole("progressbar", { name: "Прогресс добавления принтера" })).toBeTruthy();
    expect(screen.queryByText("PlagID")).toBeNull();
    expect(window.location.search).toBe("?printer_id=machine-1&return_to=%2Fprinters%2Fmachine-1");
    window.history.pushState(null, "", "/");
  });

  it("гость открывает /legal/privacy по прямой ссылке и видит черновик с подвалом", async () => {
    window.history.pushState(null, "", "/legal/privacy");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Политика приватности", level: 1 })).toBeTruthy();
    expect(screen.getByText("Черновая редакция — документ готовится к утверждению оператором. Актуальная версия будет опубликована здесь.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Публичная лицензия" }).getAttribute("href")).toBe("/legal/license");
    expect(screen.getByRole("link", { name: "Подробнее" }).getAttribute("href")).toBe("/legal/privacy");
    expect(screen.getByText("© 2026 3mf.tech")).toBeTruthy();
    expect(screen.getByText(`v${version.year}.${version.release}.${version.minor}`)).toBeTruthy();
    window.history.pushState(null, "", "/");
  });

  // MF-355, Фаза 2: AuthGate подменяет приложение экраном выбора хендла, пока хендл не подтверждён.
  it("handle_confirmed:false → показывает выбор хендла вместо приложения", async () => {
    mockFetch({
      "/auth/session": { user: { ...user, username: "user7", handle_confirmed: false } },
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Выберите логин", level: 1 })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Логин" }) as HTMLInputElement).value).toBe("user7");
  });

  it("сохраняет шапку, поиск, капсулу и aurora при смене корневого раздела", async () => {
    window.history.replaceState(null, "", "/feed");
    const fetchMock = mockFetch({
      "/auth/session": { user },
      "/me/activation": {
        activation: {
          state: "returning",
          has_printer: false,
          primary_persona: null,
          home_tier: "auto",
          activation_checklist: {},
          home_dismissed_prompts: {},
        },
        printers: [],
        filaments: [],
      },
      "/feed": { items: [], next_cursor: null },
    });

    const view = render(<App />);
    await waitFor(() => expect(view.container.querySelector(".homeTopbar")).toBeTruthy());
    const header = view.container.querySelector<HTMLElement>(".homeTopbar")!;
    const nav = within(header).getByRole("tablist", { name: "Разделы" });
    const search = within(header).getByRole("search");
    const capsule = within(header).getByRole("group", { name: "Панель пользователя" });
    const aurora = view.container.querySelector<HTMLElement>(".appShellAurora");
    const isActivationRead = ([input, init]: [RequestInfo | URL, RequestInit?]) =>
      String(input).replace(/\?.*$/, "").endsWith("/me/activation") && init?.method !== "PATCH";
    await waitFor(() => expect(fetchMock.mock.calls.some(isActivationRead)).toBe(true));
    const activationFetchesBeforeNavigation = fetchMock.mock.calls.filter(isActivationRead).length;

    fireEvent.click(within(nav).getByRole("tab", { name: "Принтеры" }));
    await waitFor(() => expect(window.location.pathname).toBe("/printers"));
    await waitFor(() => expect(within(header).getByRole("textbox", { name: "Какой принтер ищете?" })).toBeTruthy());

    expect(view.container.querySelector(".homeTopbar")).toBe(header);
    expect(within(header).getByRole("search")).toBe(search);
    expect(within(header).getByRole("group", { name: "Панель пользователя" })).toBe(capsule);
    expect(view.container.querySelector(".appShellAurora")).toBe(aurora);
    expect(view.container.querySelectorAll(".appShellAurora")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(isActivationRead)).toHaveLength(activationFetchesBeforeNavigation);

    fireEvent.click(within(nav).getByRole("tab", { name: "Материалы" }));
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe("/materials?kind=filament"));
    expect(view.container.querySelector(".homeTopbar")).toBe(header);
    expect(within(header).getByRole("tab", { name: "Материалы" }).getAttribute("aria-selected")).toBe("true");
    expect(view.container.querySelector(".appShellAurora")).toBe(aurora);
    window.history.replaceState(null, "", "/");
  });
});

describe("footer", () => {
  it("показывает разделы по важности, а служебную строку — после них", () => {
    render(<Footer />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    const footerText = screen.getByRole("contentinfo").textContent ?? "";

    expect(headings).toEqual(["О портале", "Навигация", "Юридическая информация"]);
    expect(footerText.indexOf("© 2026 3mf.tech")).toBeGreaterThan(footerText.indexOf("Юридическая информация"));
    expect(footerText.indexOf(`v${version.year}.${version.release}.${version.minor}`)).toBeGreaterThan(footerText.indexOf("Юридическая информация"));
  });
});

// Машина состояний дома (MF-435/MF-436): first_run → онбординг, returning → дом.
describe("home state machine", () => {
  it("first_run → рендерится first-run флоу (вопрос персоны)", async () => {
    mockFetch({
      "/me/activation": {
        activation: {
          state: "first_run",
          has_printer: false,
          primary_persona: null,
          home_tier: "auto",
          activation_checklist: {},
          home_dismissed_prompts: {},
        },
        printers: [],
        filaments: [],
      },
    });
    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeScreen user={user} section="home" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText(/Что вас сюда привело/)).toBeTruthy();
  });

  it("returning → рендерится дом (AI-поиск)", async () => {
    mockFetch({
      "/me/activation": {
        activation: {
          state: "returning",
          has_printer: false,
          primary_persona: null,
          home_tier: "auto",
          activation_checklist: {},
          home_dismissed_prompts: {},
        },
        printers: [],
        filaments: [],
      },
    });
    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeScreen user={user} section="home" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByPlaceholderText("Найти или создать модель")).toBeTruthy();
    expect(screen.queryByText(/Что вас сюда привело/)).toBeNull();
  });
});
