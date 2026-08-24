import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { MaterialsScreen } from "./materialsscreen.tsx";

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };
const material = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "PLA Basic",
  kind: "filament" as const,
  vendor: { id: "v1", slug: "prusa", name: "Prusa" },
  material_type: { id: "t1", slug: "pla", name: "PLA" },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/materials");
});

function renderScreen() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <MaterialsScreen user={user} section="printers" onSectionChange={() => {}} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("MaterialsScreen (MF-1476)", () => {
  it("показывает loading-состояние до ответа каталога", async () => {
    let resolvePage: (value: Response) => void = () => {};
    const pendingPage = new Promise<Response>((resolve) => {
      resolvePage = resolve;
    });
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (!String(input).startsWith("/materials")) {
        return Promise.resolve(new Response(JSON.stringify({ activation: null, printers: [], filaments: [] }), { status: 200 }));
      }
      return pendingPage;
    });
    vi.stubGlobal("fetch", fetchSpy);

    renderScreen();

    const loadingGrid = screen.getByRole("status", { name: "Загрузка материалов" });
    expect(loadingGrid.querySelectorAll("[data-skeleton=material-tile]")).toHaveLength(8);
    expect(loadingGrid.querySelectorAll(".materialSkeletonMark")).toHaveLength(8);
    expect(loadingGrid.querySelectorAll(".materialSkeletonLine--title")).toHaveLength(8);
    resolvePage(new Response(JSON.stringify({ materials: [material], total: 1, limit: 24, offset: 0, has_more: false }), { status: 200 }));
    expect(await screen.findByText("PLA Basic")).toBeTruthy();
  });

  it("показывает empty-состояние для deep-link без результатов", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/me/activation") {
        return new Response(JSON.stringify({ activation: null, printers: [], filaments: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ materials: [], total: 0, limit: 24, offset: 0, has_more: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    window.history.replaceState(null, "", "/materials?q=несуществующий");

    renderScreen();

    expect(await screen.findByText("По этим условиям материалов нет")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Сбросить фильтры" })).toHaveLength(1);
    expect(window.location.search).toBe("?q=%D0%BD%D0%B5%D1%81%D1%83%D1%89%D0%B5%D1%81%D1%82%D0%B2%D1%83%D1%8E%D1%89%D0%B8%D0%B9");
  });

  it("отправляет поиск и текстовые фильтры через доступные поля", async () => {
    const actor = userEvent.setup();
    const requests: string[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/me/activation") {
        return new Response(JSON.stringify({ activation: null, printers: [], filaments: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ materials: [material], total: 1, limit: 24, offset: 0, has_more: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    renderScreen();
    expect(await screen.findByText("PLA Basic")).toBeTruthy();

    expect(screen.getByLabelText("Поиск материалов").classList.contains("uiInput")).toBe(true);
    expect(screen.getByRole("button", { name: "Смола" }).classList.contains("uiChip")).toBe(true);

    await actor.type(screen.getByLabelText("Поиск материалов"), "PETG");
    await actor.type(screen.getByLabelText("БРЕНД"), "Prusa");
    await actor.type(screen.getByLabelText("ТИП"), "PLA");
    await actor.type(screen.getByLabelText("ЦВЕТ"), "чёрный");

    await waitFor(() => expect(requests).toContain("/materials?q=PETG&vendor=Prusa&type=PLA&color=black&limit=24"));
    expect(screen.getByRole("button", { name: "Поиск: PETG ×" }).classList.contains("uiButton")).toBe(true);
    expect(screen.getByRole("button", { name: "Бренд: Prusa ×" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Тип: PLA ×" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Цвет: чёрный ×" })).toBeTruthy();
  });

  it("даёт очистить каждый текстовый фильтр с клавиатуры", async () => {
    const actor = userEvent.setup();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/me/activation") return new Response(JSON.stringify({ activation: null, printers: [], filaments: [] }), { status: 200 });
      return new Response(JSON.stringify({ materials: [material], total: 1, limit: 24, offset: 0, has_more: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    renderScreen();
    await screen.findByText("PLA Basic");
    await actor.type(screen.getByLabelText("ЦВЕТ"), "чёрный");
    const clearColor = await screen.findByRole("button", { name: "Очистить цвет" });
    expect(clearColor.classList.contains("uiIconButton")).toBe(true);
    await actor.click(clearColor);

    expect((screen.getByLabelText("ЦВЕТ") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Очистить цвет" })).toBeNull();
  });

  it("возвращает фокус на кнопку фильтров после закрытия mobile sheet", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/me/activation") return new Response(JSON.stringify({ activation: null, printers: [], filaments: [] }), { status: 200 });
      return new Response(JSON.stringify({ materials: [material], total: 1, limit: 24, offset: 0, has_more: false }), { status: 200 });
    }));

    renderScreen();
    await screen.findByText("PLA Basic");
    const filterButton = screen.getByRole("button", { name: "Фильтры" });
    fireEvent.click(filterButton);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть фильтры" }));

    expect(document.activeElement).toBe(filterButton);
  });

  it("загружает карточки, сохраняет deep-link фильтры и ведёт по UUID detail-маршруту", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/materials")) {
        return new Response(JSON.stringify({ materials: [material], total: 1, limit: 24, offset: 0, has_more: false }), { status: 200 });
      }
      if (String(input) === "/me/activation") {
        return new Response(JSON.stringify({ activation: null, printers: [], filaments: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    window.history.replaceState(null, "", "/materials?q=PLA&kind=filament");

    renderScreen();

    expect(await screen.findByText("PLA Basic")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Открыть материал Prusa PLA Basic" }).getAttribute("href")).toBe("/materials/11111111-1111-4111-8111-111111111111");
    expect(fetchSpy.mock.calls.some(([input]) => String(input) === "/materials?q=PLA&kind=filament&limit=24")).toBe(true);
    expect(window.location.search).toBe("?q=PLA&kind=filament");
  });

  it("переключение класса обновляет запрос и убирает старую выдачу до ответа", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/me/activation") {
        return new Response(JSON.stringify({ activation: null, printers: [], filaments: [] }), { status: 200 });
      }
      const query = String(input);
      const next = query.includes("kind=resin") ? { ...material, id: "22222222-2222-4222-8222-222222222222", name: "Resin Clear", kind: "resin" as const } : material;
      return new Response(JSON.stringify({ materials: [next], total: 1, limit: 24, offset: 0, has_more: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    renderScreen();
    expect(await screen.findByText("PLA Basic")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Смола" }));

    await waitFor(() => expect(screen.queryByText("PLA Basic")).toBeNull());
    expect(await screen.findByText("Resin Clear")).toBeTruthy();
    expect(window.location.search).toBe("?kind=resin");
  });

  it("ошибка загрузки показывает повтор запроса", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    renderScreen();
    expect((await screen.findByRole("alert")).textContent).toContain("Каталог не отвечает.");
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() => expect(fetchSpy.mock.calls.filter(([input]) => String(input).startsWith("/materials")).length).toBe(2));
  });

  it("догружает следующую страницу, не убирая уже показанные карточки", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/me/activation") return new Response(JSON.stringify({ activation: null, printers: [], filaments: [] }), { status: 200 });
      const secondPage = String(input).includes("offset=1");
      const next = { ...material, id: "33333333-3333-4333-8333-333333333333", name: "PETG Strong" };
      return new Response(JSON.stringify({ materials: [secondPage ? next : material], total: 2, limit: 24, offset: secondPage ? 1 : 0, has_more: !secondPage }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    renderScreen();
    expect(await screen.findByText("PLA Basic")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Показать ещё" }));

    expect(await screen.findByText("PETG Strong")).toBeTruthy();
    expect(screen.getByText("PLA Basic")).toBeTruthy();
    expect(window.location.search).toBe("?offset=1");
  });
});
