import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { PrinterReleasesScreen } from "./releasesscreen.tsx";

// `/printers/releases` (MF-833, docs/design/printers.md) — календарь новинок, на той же
// фикстуре-фолбэке, что каталог `/printers` (printersscreen.test.tsx): `GET /releases` отвечает
// гостю 401 (nav.sections.md §4), экран не обращается к гейтованному API напрямую.

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/printers/releases");
  localStorage.removeItem("portal.printers.releasesubs.v1");
});

describe("PrinterReleasesScreen (MF-833)", () => {
  it("рендерит wide-шапку и месяцы из фикстуры, без обращения к /machines/vendors/releases", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterReleasesScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector('.homeTopbar[data-shell="full"]')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/Vulcan|Nebula|Snapmaker|Bambu Lab/).length).toBeGreaterThan(0));
    const gatedCalls = fetchSpy.mock.calls.filter(([input]) => /\/(machines|vendors|releases)(\?|$)/.test(String(input)));
    expect(gatedCalls).toHaveLength(0);
  });

  it("гость (user=null) тоже видит календарь и без карточки принтера видит нейтральную подпись", async () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterReleasesScreen user={null} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Vulcan|Nebula/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/пока без карточки/).length).toBeGreaterThan(0);
  });

  it("показывает прошлые релизы доступным аккордеоном с количеством и шевроном", async () => {
    const interaction = userEvent.setup();
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterReleasesScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Vulcan/).length).toBeGreaterThan(0));
    // K1 Max (2024, событие позади) сначала скрыт под «Раньше».
    expect(screen.queryByText(/K1 Max/)).toBeNull();
    const pastToggle = screen.getByRole("button", { name: "Показать остальные (3)" });
    expect(pastToggle.getAttribute("aria-expanded")).toBe("false");
    expect(pastToggle.querySelector("svg[aria-hidden='true']")).toBeTruthy();

    await interaction.click(pastToggle);

    expect(screen.getByRole("button", { name: "Скрыть остальные (3)" }).getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(screen.getByText(/K1 Max/)).toBeTruthy());
  });

  it("оставляет строку и CTA уведомления отдельными фокусируемыми действиями", async () => {
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterReleasesScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Vulcan|Nebula/).length).toBeGreaterThan(0));

    const card = container.querySelector<HTMLElement>(".prnReleaseCard");
    expect(card?.tabIndex).toBe(0);
    expect(card?.querySelector("button.uiChip")).toBeTruthy();
    expect(card?.querySelectorAll("button.uiChip")).toHaveLength(1);
  });

  it("«Уведомить о выходе» — гость получает промпт входа, не тихую подписку", async () => {
    const interaction = userEvent.setup();
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterReleasesScreen user={null} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Vulcan/).length).toBeGreaterThan(0));
    const chip = screen.getAllByRole("button", { name: "Уведомить о выходе" })[0]!;
    await interaction.click(chip);
    await waitFor(() => expect(screen.getByText("Войдите, чтобы продолжить")).toBeTruthy());
  });

  it("«Уведомить о выходе» авторизованного пользователя — оптимистичная подписка, видимое состояние", async () => {
    const interaction = userEvent.setup();
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterReleasesScreen user={user} section="printers" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Vulcan/).length).toBeGreaterThan(0));
    const chip = screen.getAllByRole("button", { name: "Уведомить о выходе" })[0]!;
    await interaction.click(chip);
    await waitFor(() => expect(screen.getAllByText("Уведомления включены").length).toBeGreaterThan(0));
  });
});
