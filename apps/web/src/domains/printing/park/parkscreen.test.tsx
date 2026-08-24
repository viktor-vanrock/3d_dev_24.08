import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import firmwarePilotContract from "../../../../../../packages/contracts/http/fixtures/firmware-pilot.v1.json";
import { ParkScreen } from "./parkscreen.tsx";
import type { LiveState } from "./livesource.ts";

type FirmwarePilotFixture = {
  examples: Array<{
    model: { brand: string; name: string; slug: string };
    pilot_status: Record<string, unknown>;
  }>;
  no_data_example: Record<string, unknown>;
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
    printers: [
      {
        id: "ender-ke",
        brand: "Creality",
        model: "Ender-3 V3 KE",
        is_primary: true,
        verified: true,
        link_source: "manual",
      },
    ],
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

describe("ParkScreen (MF-1615)", () => {
  it("показывает в пустом парке один акцентный сценарий добавления", () => {
    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Добавить принтер/ })).toHaveLength(1);
  });

  it("показывает источник и границу сети для managed-local и не предлагает управление без capability", async () => {
    state.activation.printers = [
      {
        id: "local-printer",
        brand: "Voron",
        model: "Trident",
        is_primary: true,
        verified: true,
        link_source: "agent",
      },
    ];
    state.canonByModel = {
      [canonKey("Voron", "Trident")]: {
        slug: "voron.trident",
        supportLevel: "managed",
        connectorType: "moonraker",
        firmwareReady: false,
        firmwarePublic: false,
      },
    };
    state.liveByPrinter = {
      "local-printer": {
        phase: "ready",
        progress: null,
        nozzle: null,
        bed: null,
        chamber: null,
        jobId: null,
        updatedAt: "2026-07-16T08:00:00Z",
        live: true,
        availabilityReason: "available",
        lastConfirmedAt: "2026-07-16T08:00:00Z",
        connectionMode: "managed-local",
        commandCapabilities: { start: false, pause: false, stop: false },
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    expect(await screen.findByText("Источник: локальный запрос")).toBeTruthy();
    expect(screen.getByText("В этой сети")).toBeTruthy();
    expect(screen.queryByText("Управление пока недоступно")).toBeNull();
    expect(screen.queryByText("Через наш агент")).toBeNull();
  });

  it("открывает /printer/:id для managed-local строки вместо модалки редактирования (MF-1836)", async () => {
    state.activation.printers = [
      {
        id: "local-printer",
        brand: "Creality",
        model: "Ender-3 V3 KE",
        is_primary: true,
        verified: true,
        link_source: "ip",
      },
    ];
    state.canonByModel = {
      [canonKey("Creality", "Ender-3 V3 KE")]: {
        slug: "creality.ender-3-v3-ke",
        supportLevel: "managed",
        connectorType: "moonraker",
        firmwareReady: false,
        firmwarePublic: false,
      },
    };
    state.liveByPrinter = {
      "local-printer": {
        phase: "ready",
        progress: null,
        nozzle: null,
        bed: null,
        chamber: null,
        jobId: null,
        updatedAt: "2026-07-16T08:00:00Z",
        live: true,
        availabilityReason: "available",
        lastConfirmedAt: "2026-07-16T08:00:00Z",
        connectionMode: "managed-local",
        commandCapabilities: { start: false, pause: false, stop: false, resume: false, cancel: false, gcode: false },
      },
    };

    const events = userEvent.setup();
    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    const row = await screen.findByRole("button", { name: /Ender-3 V3 KE/ });
    await events.click(row);

    expect(window.location.pathname).toBe("/printer/local-printer");
  });

  it("не повышает неизвестную привязку из link_source до managed", async () => {
    state.activation.printers = [
      {
        id: "unknown-printer",
        brand: "Unknown",
        model: "Model",
        is_primary: true,
        verified: true,
        link_source: "agent",
      },
    ];

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    expect(await screen.findByText("Поддержка уточняется")).toBeTruthy();
    expect(screen.queryByText("Управляется")).toBeNull();
  });

  it("не объявляет custom без явной firmware_ready", async () => {
    state.activation.printers = [
      {
        id: "custom-soon",
        brand: "Creality",
        model: "K2 Plus",
        is_primary: true,
        verified: true,
        link_source: "agent",
      },
    ];
    state.canonByModel = {
      [canonKey("Creality", "K2 Plus")]: {
        slug: "creality.k2-plus",
        supportLevel: "custom",
        connectorType: "moonraker",
        firmwareReady: false,
        firmwarePublic: false,
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    expect(await screen.findByText("Custom: скоро")).toBeTruthy();
    expect(screen.queryByText("Полный портал")).toBeNull();
  });

  it("показывает для consumer fixtures KE и V400 только признак устаревших данных", async () => {
    state.activation.printers = firmwarePilotFixture.examples.map(({ model }, index) => ({
      id: `pilot-${index}`,
      brand: model.brand,
      model: model.name,
      is_primary: index === 0,
      verified: true,
      link_source: "manual",
    }));
    state.canonByModel = Object.fromEntries(
      firmwarePilotFixture.examples.map(({ model, pilot_status }) => [
        canonKey(model.brand, model.name),
        {
          slug: model.slug,
          connectorType: null,
          firmwareReady: false,
          firmwarePublic: false,
          pilotStatus: pilot_status,
        },
      ]),
    );

    render(
      <ParkScreen
        user={user}
        section="printers"
        onSectionChange={() => {}}
      />,
    );

    const labels = await screen.findAllByText("Пилот прошивки: данные устарели");
    expect(labels).toHaveLength(2);
    expect(screen.queryByText("Пилот прошивки: не начат")).toBeNull();
    expect(document.body.textContent).not.toMatch(/lan_endpoint|\bip\b|token|credential|command/i);

    // §3.3 «устаревший факт»: tone="warn" (не dim — иначе неотличим от «нет данных»), плюс вторая
    // dim-строка «Последний факт: {стадия по словарю §3.2}, обновлено {дата}» и доступное имя с моделью.
    for (const label of labels) {
      expect(label.closest(".uiStatusPill")?.getAttribute("data-tone")).toBe("warn");
    }
    for (const { model, pilot_status } of firmwarePilotFixture.examples) {
      const date = new Date(pilot_status.updated_at as string).toLocaleString("ru-RU");
      expect(screen.getByText(`Последний факт: не начат, обновлено ${date}`)).toBeTruthy();
      expect(
        screen.getByRole("group", {
          name: `Пилот прошивки ${model.brand} ${model.name}: данные устарели. Последний факт — не начат, обновлён ${date}`,
        }),
      ).toBeTruthy();
    }
  });

  it.each([
    ["явный no_data", firmwarePilotFixture.no_data_example],
    ["переходное отсутствие поля", undefined],
  ])("не рендерит виджет пилота для %s (MF-1867)", async (_caseName, pilotStatus) => {
    state.activation.printers = [
      {
        id: "ender-ke",
        brand: "Creality",
        model: "Ender-3 V3 KE",
        is_primary: true,
        verified: true,
        link_source: "manual",
      },
    ];
    state.canonByModel = {
      [canonKey("Creality", "Ender-3 V3 KE")]: {
        slug: "creality.ender-3-v3-ke",
        connectorType: null,
        firmwareReady: false,
        firmwarePublic: false,
        pilotStatus,
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    await screen.findByRole("button", { name: /Ender-3 V3 KE/ });
    expect(screen.queryByText(/Пилот прошивки/)).toBeNull();
  });

  it("не показывает виджет пилота на непилотных карточках парка рядом с пилотной (MF-1867)", async () => {
    state.activation.printers = [
      {
        id: "ender-ke",
        brand: "Creality",
        model: "Ender-3 V3 KE",
        is_primary: true,
        verified: true,
        link_source: "manual",
      },
      {
        id: "ender-se",
        brand: "Creality",
        model: "Ender-3 V3 SE",
        is_primary: false,
        verified: true,
        link_source: "manual",
      },
    ];
    state.canonByModel = {
      [canonKey("Creality", "Ender-3 V3 KE")]: {
        slug: "creality.ender-3-v3-ke",
        connectorType: null,
        firmwareReady: false,
        firmwarePublic: false,
        pilotStatus: {
          status: "reported",
          stage: "building",
          updated_at: "2026-07-15T01:00:00Z",
          freshness: "fresh",
          source: "fleet",
          confidence: "limited",
        },
      },
      [canonKey("Creality", "Ender-3 V3 SE")]: {
        slug: "creality.ender-3-v3-se",
        supportLevel: "list",
        connectorType: null,
        firmwareReady: false,
        firmwarePublic: false,
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    // MF-1868: словарь §3.2 — "building" → «сборка», не сырой enum.
    expect(await screen.findByText("Пилот прошивки: сборка")).toBeTruthy();
    expect(screen.queryAllByText(/Пилот прошивки/)).toHaveLength(1);
    expect(screen.queryByText("Пилот прошивки: нет данных о пилоте")).toBeNull();
  });

  // Словарь park.md §3.2 «стадия контракта → текст» — сырой enum (`stage`) никогда не должен
  // попасть на экран (MF-1868).
  const STAGE_TEXT = {
    not_started: "не начат",
    building: "сборка",
    burn_in: "обкатка",
    ready: "готово",
  } as const;

  it.each(Object.keys(STAGE_TEXT) as (keyof typeof STAGE_TEXT)[])(
    "отображает текст словаря §3.2 для свежего этапа %s, tone=dim",
    async (stage) => {
      const updatedAt = "2026-07-15T01:00:00Z";
      state.activation.printers = [
        {
          id: "v400",
          brand: "FLSun",
          model: "V400",
          is_primary: true,
          verified: true,
          link_source: "manual",
        },
      ];
      state.canonByModel = {
        [canonKey("FLSun", "V400")]: {
          slug: "flsun.v400",
          connectorType: null,
          firmwareReady: false,
          firmwarePublic: false,
          pilotStatus: {
            status: "reported",
            stage,
            updated_at: updatedAt,
            freshness: "fresh",
            source: "fleet",
            confidence: stage === "ready" ? "verified" : "limited",
          },
        },
      };

      render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

      const label = await screen.findByText(`Пилот прошивки: ${STAGE_TEXT[stage]}`);
      expect(screen.queryByText(`Пилот прошивки: ${stage}`)).toBeNull();
      expect(label.closest(".uiStatusPill")?.getAttribute("data-tone")).toBe("dim");

      const date = new Date(updatedAt).toLocaleString("ru-RU");
      const ariaStage = stage === "ready" ? "готово, подтверждено" : STAGE_TEXT[stage];
      expect(
        screen.getByRole("group", { name: `Пилот прошивки FLSun V400: ${ariaStage}, данные обновлены ${date}` }),
      ).toBeTruthy();

      if (stage === "ready") expect(screen.queryByText("Полный портал")).toBeNull();
    },
  );

  it("обособляет stage=\"stopped\" отдельной веткой: «остановлено», tone=warn, без pulse", async () => {
    const updatedAt = "2026-07-15T01:00:00Z";
    state.activation.printers = [
      {
        id: "v400",
        brand: "FLSun",
        model: "V400",
        is_primary: true,
        verified: true,
        link_source: "manual",
      },
    ];
    state.canonByModel = {
      [canonKey("FLSun", "V400")]: {
        slug: "flsun.v400",
        connectorType: null,
        firmwareReady: false,
        firmwarePublic: false,
        pilotStatus: {
          status: "reported",
          stage: "stopped",
          updated_at: updatedAt,
          freshness: "fresh",
          source: "fleet",
          confidence: "limited",
        },
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    const label = await screen.findByText("Пилот прошивки: остановлено");
    const pill = label.closest(".uiStatusPill");
    expect(pill?.getAttribute("data-tone")).toBe("warn");
    expect(pill?.getAttribute("data-pulse")).toBeFalsy();

    const date = new Date(updatedAt).toLocaleString("ru-RU");
    expect(
      screen.getByRole("group", { name: `Пилот прошивки FLSun V400: остановлено, данные обновлены ${date}` }),
    ).toBeTruthy();
  });

  it("не показывает «готово» для ready с confidence!=='verified' — невалидная комбинация трактуется как нет данных", async () => {
    state.activation.printers = [
      {
        id: "v400",
        brand: "FLSun",
        model: "V400",
        is_primary: true,
        verified: true,
        link_source: "manual",
      },
    ];
    state.canonByModel = {
      [canonKey("FLSun", "V400")]: {
        slug: "flsun.v400",
        connectorType: null,
        firmwareReady: false,
        firmwarePublic: false,
        // Runtime-невалидный payload (TS это исключает, но `printer.pilot_status`/`canon.pilotStatus`
        // не всегда проходит через isFirmwarePilotStatus на этом пути) — confidence!=="verified" при
        // stage="ready" не должен звучать как готовность.
        pilotStatus: {
          status: "reported",
          stage: "ready",
          updated_at: "2026-07-15T01:00:00Z",
          freshness: "fresh",
          source: "fleet",
          confidence: "limited",
        },
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    await screen.findByRole("button", { name: /V400/ });
    expect(screen.queryByText(/Пилот прошивки/)).toBeNull();
  });

  it("рисует строку живого соединения (§2.2) для managed-принтера без пилота и заменяет её виджетом пилота, когда он виден", async () => {
    state.activation.printers = [
      {
        id: "printing-printer",
        brand: "Bambu",
        model: "P1S",
        is_primary: true,
        verified: true,
        link_source: "agent",
      },
    ];
    state.canonByModel = {
      [canonKey("Bambu", "P1S")]: {
        slug: "bambu.p1s",
        supportLevel: "managed",
        connectorType: "moonraker",
        firmwareReady: false,
        firmwarePublic: false,
      },
    };
    state.liveByPrinter = {
      "printing-printer": {
        phase: "printing",
        progress: 42,
        nozzle: null,
        bed: null,
        chamber: null,
        jobId: null,
        updatedAt: "2026-07-16T08:00:00Z",
        live: true,
        availabilityReason: "available",
        lastConfirmedAt: "2026-07-16T08:00:00Z",
        connectionMode: "managed-bridge",
        commandCapabilities: { start: true, pause: true, stop: true },
      },
    };

    render(<ParkScreen user={user} section="printers" onSectionChange={() => {}} />);

    const statusPill = await screen.findByText("Печатает");
    expect(statusPill.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
  });
});
