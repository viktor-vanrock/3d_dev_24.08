import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { PrinterCompareScreen } from "./comparescreen.tsx";
import { listPrintersFixture } from "./fixtures.ts";

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

// 2026-07-21: экран читает GET /printers (research/api.ts#listPrinters), не fixtures.ts напрямую.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/printers?")) {
        const printers = await listPrintersFixture();
        return new Response(JSON.stringify({ printers, has_more: false, next_cursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem("portal.printers.compare.v1");
});

describe("PrinterCompareScreen (MF-1740)", () => {
  it("добавляет свободную колонку и по тумблеру показывает только различия", async () => {
    const userEventInstance = userEvent.setup();
    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterCompareScreen user={user} section="printers" onSectionChange={() => {}} ids={["creality.k1-max", "creality.k2-plus"]} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const differencesSwitch = await screen.findByRole("switch", { name: "Только различия" });
    expect(differencesSwitch.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("link", { name: "Добавить принтер к сравнению" })).toBeTruthy();
    expect(screen.getByText("Статус")).toBeTruthy();

    await userEventInstance.click(differencesSwitch);

    expect(differencesSwitch.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Статус")).toBeNull();
    expect(screen.getByText("Объём печати")).toBeTruthy();
  });
});
