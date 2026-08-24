import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { PrintersScreen } from "./printersscreen.tsx";
import { listPrintersFixture } from "./fixtures.ts";

// Каталог `/printers` (MF-927, docs/design/printers.catalog.md) — с 2026-07-21 читает реальный
// GET /printers (research/api.ts#listPrinters), гость читает свободно (MF-850/912 + §7 «Гость:
// читает каталог/карточку свободно»). Тест фиксирует: wide-шапка есть, плитки рендерятся,
// гейтованный `/machines`/`/vendors`/`/releases` не вызывается. Тестовые данные — та же fixtures.ts,
// теперь отдаваемая через мокнутый fetch, а не напрямую (экран больше не импортирует fixtures.ts).

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

async function printersResponse(): Promise<Response> {
  const printers = await listPrintersFixture();
  return new Response(JSON.stringify({ printers, has_more: false, next_cursor: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/printers?")) return printersResponse();
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/printers");
});

function printerEvents(fetchSpy: ReturnType<typeof vi.fn>) {
  return fetchSpy.mock.calls
    .filter(([input]) => String(input).endsWith("/feed/events"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { event_name: string; props: Record<string, unknown> });
}

describe("PrintersScreen (MF-927)", () => {
  it("до ответа резервирует геометрию сетки и списка брендов", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(container.querySelectorAll(".prnSkeletonTile")).toHaveLength(8);
    expect(container.querySelectorAll(".prnSidebar .prnFacetSkeletonRow")).toHaveLength(6);
  });

  it("рендерит wide-шапку и сетку из фикстуры, без обращения к /machines/vendors/releases", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/printers?")) return printersResponse();
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector('.homeTopbar[data-shell="full"]')).toBeTruthy();
    expect(container.querySelector("main.homeWorkspaceBody")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/Creality|Bambu Lab|Prusa/).length).toBeGreaterThan(0));
    const gatedCalls = fetchSpy.mock.calls.filter(([input]) => /\/(machines|vendors|releases)(\?|$)/.test(String(input)));
    expect(gatedCalls).toHaveLength(0);
  });

  it("гость (user=null) тоже видит каталог", async () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={null} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Creality|Bambu Lab|Prusa/).length).toBeGreaterThan(0));
  });

  it("поиск фильтрует сетку по бренду/модели", async () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Creality|Bambu Lab|Prusa/).length).toBeGreaterThan(0));
    const input = screen.getByRole("textbox", { name: "Какой принтер ищете?" });
    fireEvent.change(input, { target: { value: "K1 Max" } });
    fireEvent.submit(input.closest("form")!);
    // Debounce 300–400мс (§2.1) — ждём, пока отфильтрует, не только пока появится совпадение
    // (K1 Max виден и до фильтрации, это не доказывает, что остальные плитки уже скрыты).
    await waitFor(() => expect(screen.queryByText(/X1 Carbon/)).toBeNull(), { timeout: 1000 });
    expect(screen.getByText(/K1 Max/)).toBeTruthy();
  });

  it("переключает «Новинки» внутри той же оболочки и сохраняет адрес каталога", async () => {
    const interaction = userEvent.setup();
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await screen.findByRole("button", { name: "Creality K1 Max" });
    const content = container.querySelector(".prnContent");
    await interaction.click(screen.getByRole("tab", { name: "Новинки" }));

    expect(window.location.pathname).toBe("/printers");
    expect(container.querySelector(".prnContent")).toBe(content);
    expect(screen.getByRole("tab", { name: "Новинки" }).getAttribute("aria-selected")).toBe("true");
  });

  it("сравнение — видимый чекбокс вне интерактивной области карточки", async () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: /Добавить к сравнению/ }).length).toBeGreaterThan(0));

    const compareCheckbox = screen.getAllByRole("checkbox", { name: /Добавить к сравнению/ }).at(0);
    expect(compareCheckbox).toBeDefined();
    expect(compareCheckbox?.closest('[role="button"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Creality K1 Max" })).toBeTruthy();
  });

  it("даёт из каталога принтеров перейти в канонический каталог филаментов", async () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const link = await screen.findByRole("link", { name: "Филаменты" });
    expect(link.getAttribute("href")).toBe("/materials");
    fireEvent.click(link);
    expect(window.location.pathname).toBe("/materials");
  });

  it("пустой поиск предлагает снять только q, сохраняет URL и даёт вошедшему ссылку добавления", async () => {
    window.history.replaceState(null, "", "/printers?q=zzzz-no-such-printer");
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const recovery = await screen.findByRole("button", { name: /Снять «Поиск» \(вернёт \d+\)/ });
    const addLink = screen.getByRole("link", { name: "Не нашли свой принтер? Добавьте →" });
    expect(addLink.getAttribute("href")).toMatch(/^\/issue\/new\?title=%D0%A5%D0%BE%D1%87%D1%83\+%D0%B7%D0%B0%D0%BF%D0%BE%D0%BB%D0%BD%D1%8F%D1%82%D1%8C\+%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3\+%D0%BF%D1%80%D0%B8%D0%BD%D1%82%D0%B5%D1%80%D0%BE%D0%B2&category=researcher-access$/);

    fireEvent.click(recovery);
    await waitFor(() => expect(screen.getByText(/K1 Max/)).toBeTruthy());
    expect(screen.queryByRole("textbox", { name: "Поиск по каталогу принтеров" })).toBeNull();
    expect(window.location.pathname).toBe("/printers");
    expect(window.location.search).toBe("");
  });

  it("гостю вторичное действие предлагает войти через общий overlay", async () => {
    window.history.replaceState(null, "", "/printers?q=zzzz-no-such-printer");
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={null} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Не нашли свой принтер? Добавьте →" }));
    expect(await screen.findByText("Войдите, чтобы продолжить")).toBeTruthy();
  });

  it("отправляет открытие каталога и применение фасета кинематики", async () => {
    const interaction = userEvent.setup();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/printers?")) return printersResponse();
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrintersScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await screen.findByRole("button", { name: "Creality K1 Max" });
    await waitFor(() =>
      expect(printerEvents(fetchSpy)).toContainEqual({
        event_name: "printer_catalog_view",
        props: { facets_active: [], sort: "recommended", source: "direct" },
      }),
    );

    await interaction.click(screen.getByRole("button", { name: "CoreXY" }));
    await waitFor(() =>
      expect(printerEvents(fetchSpy)).toContainEqual({
        event_name: "printer_facet_apply",
        props: { facet: "kinematics", value: ["corexy"] },
      }),
    );
  });
});
