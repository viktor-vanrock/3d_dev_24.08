import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SlicePrintScreen } from "./sliceprintscreeen.tsx";

const activation = vi.hoisted(() => ({
  loading: false,
  printers: [
    {
      id: "printer-1",
      brand: "Creality",
      model: "Ender-3 V3 KE",
      verified: true,
      printer_id: "catalog-printer-1",
      link_source: "agent",
    },
  ],
}));

vi.mock("../home/activation.ts", () => ({ useActivation: () => activation }));
vi.mock("../home/homeheader.tsx", () => ({ HomeHeader: () => <header /> }));
// MF-1136 добавил useInteractionSound() в CommandStatus — тому нужен OverlayProvider
// (muted-стейт), которого этот тест не поднимает; мокаем звук, как addwizard.a11y.test.tsx.
vi.mock("../sound/useinteractionsound.ts", () => ({
  useInteractionSound: () => ({ tick: vi.fn(), cta: vi.fn(), toggle: vi.fn(), nav: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), offline: vi.fn() }),
}));

const user = { id: "user-1", username: "maker", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

beforeEach(() => {
  window.history.replaceState(null, "", "/slice/slice-1/print?filename=part.gcode&profile=PLA&printer_id=printer-1&command_id=command-1");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/me/printers/printer-1/commands/command-1") {
      return {
        ok: true,
        json: async () => ({
          command_id: "command-1",
          correlation_id: "correlation-1",
          device_id: "printer-1",
          command: "gcode",
          status: "failed",
          code: "device_offline",
          message: "Устройство не подключено.",
          timestamp: "2026-07-15T12:00:01.000Z",
        }),
      };
    }
    throw new Error(`Неожиданный запрос: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SlicePrintScreen — результат отправки", () => {
  it("после reload сохраняет выбранный слайс и принтер, показывая authoritative failure", async () => {
    render(<SlicePrintScreen user={user} section="printers" onSectionChange={() => {}} sliceId="slice-1" />);

    expect(screen.getByRole("button", { name: /Creality Ender-3 V3 KE/ }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("Не выполнена")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Устройство не подключено.");
    expect(screen.getByRole("link", { name: "Открыть результат команды" }).getAttribute("href")).toContain("printer_id=printer-1");
  });
});
