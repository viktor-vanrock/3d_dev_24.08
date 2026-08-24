import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { ResearchFormScreen } from "./researchform.tsx";
import type { SessionUser } from "@shared/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const researcher: SessionUser = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "researcher" };
const plainUser: SessionUser = { ...researcher, role: "user" };

function stubFetch() {
  const fetchSpy = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("ResearchFormScreen (MF-917)", () => {
  it("без роли researcher — вербующий гейт вместо формы", async () => {
    stubFetch();
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchFormScreen user={plainUser} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("Это рабочее место команды Ресёрчеров")).toBeTruthy());
    expect(screen.queryByText("Новая карточка")).toBeNull();
  });

  it("/research/new: wide-шапка, заголовок «Новая карточка», кнопка «Сохранить» никогда не задизейблена пустыми полями (§2.8)", async () => {
    stubFetch();
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchFormScreen user={researcher} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("Новая карточка")).toBeTruthy());
    expect(container.querySelector('.homeTopbar[data-shell="full"]')).toBeTruthy();
    const saveButton = screen.getByText("Сохранить").closest("button");
    expect(saveButton?.disabled).toBeFalsy();
  });

  it("/research/new: секции в фиксированном порядке — Идентичность → Фото → Спеки → _meta (§2.2)", async () => {
    stubFetch();
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchFormScreen user={researcher} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("Новая карточка")).toBeTruthy());
    const titles = Array.from(document.querySelectorAll(".rsSectionTitle")).map((el) => el.textContent);
    expect(titles[0]).toBe("Идентичность");
    expect(titles[1]).toBe("Фото");
    expect(titles[titles.length - 1]).toBe("_meta");
  });

  it("карточка не найдена по slug — честное сообщение со ссылкой назад в очередь, не крашится", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/research/printers/")) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <ThemeProvider>
        <OverlayProvider>
          <ResearchFormScreen user={researcher} slug="nope.nothing" section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Карточка не найдена/)).toBeTruthy());
  });
});
