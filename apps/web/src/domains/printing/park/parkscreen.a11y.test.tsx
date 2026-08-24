import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import firmwarePilotContract from "../../../../../../packages/contracts/http/fixtures/firmware-pilot.v1.json";
import { ParkScreen } from "./parkscreen.tsx";
import type { LiveState } from "./livesource.ts";

// MF-1588 — accessibility-аудит /park (semantics/accessible-name/live-region assertions,
// доп. к функциональным сценариям parkscreen.test.tsx). Проверяет только то, что уже верно
// сегодня — регрессионный барьер, не подтверждение полного соответствия
// docs/design/park.md §2–3 (расхождения — docs/audits/park.pilot.a11y.mf1588.md).

type FirmwarePilotFixture = {
  examples: Array<{ model: { brand: string; name: string; slug: string }; pilot_status: Record<string, unknown> }>;
};

const firmwarePilotFixture = firmwarePilotContract as FirmwarePilotFixture;
const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function canonKey(brand: string, model: string) {
  return `${brand}::${model}`;
}

const state = vi.hoisted(() => ({
  activation: {
    loading: false,
    activation: null,
    printers: [] as Array<{ id: string; brand: string; model: string; is_primary: boolean; verified: boolean; link_source: string }>,
    filaments: [],
    patch: vi.fn(),
    addPrinter: vi.fn(),
    addFilament: vi.fn(),
    updatePrinter: vi.fn(),
    updateFilament: vi.fn(),
    removePrinter: vi.fn(),
    removeFilament: vi.fn(),
  },
  canonByModel: {} as Record<string, unknown>,
  liveByPrinter: {} as Record<string, LiveState | null>,
}));

vi.mock("@shared/lib/activation.ts", () => ({ useActivation: () => state.activation }));
vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header data-testid="site-header" /> }));
vi.mock("@platform/overlay", () => ({ useOverlay: () => ({ modal: () => ({ close: vi.fn() }), toast: vi.fn() }) }));
vi.mock("@shared/ui/aurorabg.tsx", () => ({ AuroraBackground: () => null }));
vi.mock("./printercanon.ts", () => ({
  findPrinterCanon: vi.fn(async (brand: string, model: string) => state.canonByModel[canonKey(brand, model)] ?? null),
}));
vi.mock("./livesource.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./livesource.ts")>();
  return {
    ...actual,
    httpPrinterLiveSource: () => ({
      subscribe: (printerId: string, callback: (live: LiveState) => void) => {
        const live = state.liveByPrinter[printerId];
        if (live) callback(live);
        return () => {};
      },
    }),
  };
});

beforeEach(() => {
  state.activation.printers = [];
  state.canonByModel = {};
  state.liveByPrinter = {};
});

afterEach(() => cleanup());

describe("MF-1588: семантика и доступные имена /park", () => {
  it("пустой парк — один h1 «Мой парк», без строк парка, ровно один путь добавления", () => {
    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    expect(screen.getByRole("heading", { name: "Мой парк" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Добавить принтер" })).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /Печатает|На связи|На паузе|Ошибка|Не в сети/ })).toHaveLength(0);
  });

  it("сводка парка — единственный live-region на странице (role=status, aria-live=polite)", () => {
    state.activation.printers = [
      { id: "ender-ke", brand: "Creality", model: "Ender-3 V3 KE", is_primary: true, verified: true, link_source: "manual" },
    ];

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    const live = screen.getByText(/принтер.*·.*печатает.*·.*на связи/);
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it("строка принтера — нативная кнопка с доступным именем, включающим модель и бейдж уровня", async () => {
    state.activation.printers = [
      { id: "ender-ke", brand: "Creality", model: "Ender-3 V3 KE", is_primary: true, verified: true, link_source: "manual" },
    ];
    state.canonByModel = {
      [canonKey("Creality", "Ender-3 V3 KE")]: {
        slug: "creality.ender-3-v3-ke",
        connectorType: null,
        firmwareReady: false,
        firmwarePublic: false,
        pilotStatus: firmwarePilotFixture.examples[0]!.pilot_status,
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    // MF-1868: доступное имя строки пилота теперь несёт модель+точный текст §3.3 через
    // свой aria-label (role="group"), поэтому у устаревшего факта оно заменяет голый
    // «Пилот прошивки: данные устарели» на «Пилот прошивки {модель}: данные устарели. Последний факт — …».
    const date = new Date(firmwarePilotFixture.examples[0]!.pilot_status.updated_at as string).toLocaleString("ru-RU");
    const row = await screen.findByRole("button", {
      name: new RegExp(
        `Ender-3 V3 KE.*Поддержка уточняется.*Пилот прошивки Creality Ender-3 V3 KE: данные устарели\\. Последний факт — не начат, обновлён ${date}`,
        "s",
      ),
    });
    expect(row.tagName).toBe("BUTTON");
  });

  it("не полагается на цвет — тон строки пилота всегда сопровождается текстом (MF-1867: no_data скрыт, а не покрашен)", async () => {
    state.activation.printers = [
      { id: "ender-ke", brand: "Creality", model: "Ender-3 V3 KE", is_primary: true, verified: true, link_source: "manual" },
      { id: "se", brand: "Creality", model: "Ender-3 V3 SE", is_primary: false, verified: true, link_source: "manual" },
    ];
    state.canonByModel = {
      [canonKey("Creality", "Ender-3 V3 KE")]: {
        slug: "creality.ender-3-v3-ke",
        connectorType: null,
        firmwareReady: false,
        firmwarePublic: false,
        pilotStatus: firmwarePilotFixture.examples[0]!.pilot_status,
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    expect(await screen.findByText("Пилот прошивки: данные устарели")).toBeTruthy();
    // Непилотная модель без pilot_status (MF-1867) не рендерит пилюлю вовсе, а не
    // красит её нейтральным тоном — единственная строка «Пилот прошивки: …» на странице.
    expect(screen.getAllByText(/Пилот прошивки/)).toHaveLength(1);
  });
});
