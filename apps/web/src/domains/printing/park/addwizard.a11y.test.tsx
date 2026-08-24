import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 4.2): printing-тест→onboarding PrinterPicker, развязка отложена до pages/DI. См. MIGRATION.md.
import { PrinterPicker } from "@domains/onboarding";
import { ParkAddScreen } from "./addwizard.tsx";
import { LevelTiles } from "./leveltiles.tsx";

const { activationState, overlayApi, interactionSound } = vi.hoisted(() => ({
  activationState: {
    loading: false,
    activation: null,
    printers: [],
    filaments: [],
    patch: vi.fn(),
    addPrinter: vi.fn(async () => null),
    addFilament: vi.fn(),
    updatePrinter: vi.fn(),
    updateFilament: vi.fn(),
    removePrinter: vi.fn(),
    removeFilament: vi.fn(),
  },
  overlayApi: {
    toast: vi.fn(),
    confirm: vi.fn(async () => false),
    modal: vi.fn(),
    sheet: vi.fn(),
    alert: vi.fn(),
    notifications: { items: [], unreadCount: 0, muted: true, notify: vi.fn(), markAllRead: vi.fn(), setMuted: vi.fn() },
  },
  interactionSound: { tick: vi.fn(), cta: vi.fn(), toggle: vi.fn(), nav: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), offline: vi.fn() },
}));

vi.mock("@shared/lib/activation.ts", () => ({ useActivation: () => activationState }));
vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header data-testid="site-header" /> }));
vi.mock("@platform/overlay", () => ({ useOverlay: () => overlayApi }));
vi.mock("@platform/sound", () => ({ useInteractionSound: () => interactionSound }));
vi.mock("./printercanon.ts", () => ({ findPrinterCanon: vi.fn(async () => null) }));
vi.mock("./ipcheck.ts", () => ({ checkMoonrakerIp: vi.fn(() => new Promise(() => {})) }));
vi.mock("./enroll.ts", () => ({
  fetchPrinterIds: vi.fn(() => new Promise(() => {})),
  createEnrollCode: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ machines: [] }), { status: 200 })));
  window.history.replaceState(null, "", "/park/add");
});

describe("MF-1530: семантика мастера добавления принтера", () => {
  it("сохраняет общий хедер и отдельные визуальные роли поиска и прогресса", () => {
    render(<ParkAddScreen user={null} section="printers" onSectionChange={() => {}} />);

    expect(screen.getByTestId("site-header")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Поиск принтера" }).classList.contains("parkWizardSearch")).toBe(true);
    expect(screen.getByRole("progressbar").classList.contains("parkWizardProgressTrack")).toBe(true);
    expect(screen.getByRole("progressbar").firstElementChild?.classList.contains("parkWizardProgressFill")).toBe(true);
  });

  it("даёт ручным полям устойчивые доступные имена вместо placeholder", async () => {
    const addPrinter = vi.fn(async () => null);
    render(<PrinterPicker persona={null} addPrinter={addPrinter} onLinked={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Не нашли? Указать вручную" }));

    for (const name of ["Бренд", "Модель", "X мм", "Y мм", "Z мм", "Сопло мм"]) {
      expect(screen.getByRole("textbox", { name }).getAttribute("placeholder")).toBe(name);
    }
  });

  it("имеет ровно один h1 на шаге выбора модели", () => {
    render(<ParkAddScreen user={null} section="printers" onSectionChange={() => {}} />);

    expect(document.querySelector(".parkScreen")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Какой у вас принтер?");
  });

  it("имеет ровно один h1 на шаге подключения", () => {
    window.history.replaceState(null, "", "/park/add?brand=Creality&model=Ender-3");
    render(<ParkAddScreen user={null} section="printers" onSectionChange={() => {}} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Что вы хотите делать");
  });

  it("объявляет загрузку канона, проверки IP и enroll через status и aria-busy", () => {
    const user = { id: "user-1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };
    const onDone = vi.fn();
    render(
      <LevelTiles
        brand="Creality"
        model="Ender-3"
        canon={{ connectorType: "moonraker" }}
        canonLoading
        overlay={overlayApi}
        user={user}
        onDiy={vi.fn()}
        onCommunityFirmware={vi.fn()}
        onDone={onDone}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("Проверяем данные каталога");

    fireEvent.click(screen.getByRole("radio", { name: /Управлять, пока дома/ }));
    const ipInput = screen.getByRole("textbox", { name: "IP-адрес принтера" });
    fireEvent.change(ipInput, { target: { value: "192.168.1.42" } });
    const ipButton = screen.getByRole("button", { name: "Проверить" });
    fireEvent.click(ipButton);
    expect(ipButton.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Проверяем подключение…").getAttribute("role")).toBe("status");

    fireEvent.click(screen.getByRole("radio", { name: /Управлять из любой точки, через наш агент/ }));
    fireEvent.click(screen.getByRole("button", { name: "Установить агент" }));
    expect(screen.getByText("Создаём код подключения…").getAttribute("role")).toBe("status");
  });
});
