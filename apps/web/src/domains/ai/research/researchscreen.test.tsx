import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { ResearchScreen } from "./researchscreen.tsx";
import type { SessionUser } from "@shared/types";

// Гейт роли + очередь (MF-916, docs/design/research.workbench.md §0/§1.5). Гость не тестируется
// отдельно — AuthGate (app.tsx) не рендерит ни один экран без сессии, этот компонент всегда
// получает уже авторизованного user. Роль читается синхронно из `user.role` (`GET /auth/session`,
// MF-917) — нет отдельного `GET /me/role`/состояния загрузки роли, только очередь грузится асинхронно.

const baseUser: SessionUser = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" };

function stubFetch(byPath: (path: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => byPath(String(input))),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ResearchScreen (MF-916)", () => {
  it("admin-mode использует DataShell, полный каталог и явное создание", async () => {
    window.history.pushState(null, "", "/data/printers");
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchScreen
            user={{ ...baseUser, capabilities: ["data.printers.manage"] }}
            section="printers"
            onSectionChange={() => {}}
            mode="data"
          />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByRole("navigation", { name: "Разделы данных" })).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/data/printers?scope=all"), expect.anything());
    expect(screen.getByText("Все")).toBeTruthy();
    expect(screen.getByText("С пробелами")).toBeTruthy();
    expect(screen.queryByText("Мои")).toBeNull();
    expect(screen.queryByText("Мой бренд")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Добавить принтер" }));
    expect(window.location.pathname).toBe("/data/printers/new");
  });

  it("роли нет → вербующий EmptyState, не 404/403", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchScreen user={baseUser} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText("Это рабочее место команды Ресёрчеров")).toBeTruthy();
    expect(screen.getByText("Хочу заполнять каталог")).toBeTruthy();
  });

  it("роль researcher, пустая очередь → EmptyState «Пробелов по вашему бренду нет»", async () => {
    stubFetch((path) => {
      if (path.includes("/research/printers")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response(null, { status: 404 });
    });
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchScreen user={{ ...baseUser, role: "researcher" }} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText("Пробелов по вашему бренду нет")).toBeTruthy();
    expect(screen.getByText("Ресёрчеры")).toBeTruthy();
    expect(screen.getByText("Мои")).toBeTruthy();
    expect(screen.getByText("Все")).toBeTruthy();
  });

  it("роль researcher, есть карточки → строка очереди со всеми полями §1.4", async () => {
    stubFetch((path) => {
      if (path.includes("/research/printers")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                slug: "creality.k1-max",
                brand: "Creality",
                model: "K1 Max",
                status: "shipping",
                filled_count: 5,
                confidence: "high",
                filled_by: "researcher-creality",
                filled_by_kind: "agent",
                updated_at: new Date().toISOString(),
                flagged: false,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchScreen user={{ ...baseUser, role: "researcher" }} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText("Creality · K1 Max")).toBeTruthy();
    expect(screen.getByText("creality.k1-max")).toBeTruthy();
    expect(screen.getByText("выпускается")).toBeTruthy();
    expect(screen.getByText("высокая")).toBeTruthy();
    expect(screen.getByText("researcher-creality")).toBeTruthy();
  });

  it("роль researcher, очередь не отвечает → строка ошибки с «Обновить»", async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchScreen user={{ ...baseUser, role: "researcher" }} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText(/Очередь не отвечает/)).toBeTruthy();
    expect(screen.getByText("Обновить")).toBeTruthy();
  });
});
