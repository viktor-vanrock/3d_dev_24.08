import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { loopbackHelperUrl } from "./livesource.ts";
import { PrinterLiveScreen } from "./printerlivescreen.tsx";

const user = { id: "user-1", username: "maker", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

const basics = {
  id: "printer-1",
  brand: "Creality",
  model: "Ender-3 V3 KE",
  link_source: "agent",
};

function renderLiveScreen(
  live: Record<string, unknown>,
  commandResult?: Record<string, unknown>,
  commandResponse: { status: number; body: Record<string, unknown> } = { status: 202, body: { id: "command-2", status: "queued" } },
  printerBasics: Record<string, unknown> = basics,
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/me/printers") return { ok: true, json: async () => ({ printers: [printerBasics] }) };
    if (printerBasics.lan_endpoint && url === loopbackHelperUrl(String(printerBasics.lan_endpoint))) return { ok: true, json: async () => live };
    if (url === "/me/printers/printer-1/live") return { ok: true, json: async () => live };
    if (url === "/me/printers/printer-1/commands" && init?.method === "POST") {
      return { ok: commandResponse.status >= 200 && commandResponse.status < 300, status: commandResponse.status, json: async () => commandResponse.body };
    }
    if (url === "/me/printers/printer-1/commands/command-1" && commandResult) return { ok: true, json: async () => commandResult };
    throw new Error(`Неожиданный запрос: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ThemeProvider>
      <OverlayProvider>
        <PrinterLiveScreen user={user} section="printers" onSectionChange={() => {}} id="printer-1" />
      </OverlayProvider>
    </ThemeProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("PrinterLiveScreen — состояния доступности источника", () => {
  it("MF-1666: объявляет основной статус и evidence после polling-перехода", async () => {
    const ready = {
      live: true,
      state: "ready",
      live_availability_reason: "available",
      connection_mode: "managed-bridge",
      command_capabilities: { start: true, pause: true, stop: true },
      progress: null,
      metrics: {},
      last_confirmed_at: "2026-07-15T10:00:00.000Z",
    };
    const offline = {
      live: false,
      state: "offline",
      live_availability_reason: "offline",
      connection_mode: "managed-bridge",
      command_capabilities: { start: false, pause: false, stop: false },
      progress: null,
      metrics: {},
      last_confirmed_at: "2026-07-15T10:00:00.000Z",
    };
    let liveReads = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/me/printers") {
        return { ok: true, json: async () => ({ printers: [{ ...basics, firmware_ready: true }] }) };
      }
      if (url === "/me/printers/printer-1/live") {
        // Первая повторная подписка появляется после загрузки basics; только
        // следующий интервальный tick должен моделировать polling-переход.
        return { ok: true, json: async () => (liveReads++ < 1 ? ready : offline) };
      }
      throw new Error(`Неожиданный запрос live-region: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterLiveScreen user={user} section="printers" onSectionChange={() => {}} id="printer-1" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await screen.findByText("Готов", { exact: true });
    const announcement = screen.getByRole("status", { name: "Обновления состояния подключения" });
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.getAttribute("aria-atomic")).toBe("true");
    expect(announcement.textContent).toContain("Статус принтера: Готов.");
    expect(announcement.textContent).toContain("Прошивка: Подтверждена.");
    expect(announcement.textContent).toContain("Агент enrollment: Агент привязан.");
    expect(announcement.textContent).toContain("Relay: На связи.");
    expect(announcement.textContent).toContain("Moonraker API: Доступен.");
    expect(announcement.textContent).toContain("Восстановление: Стабильно.");

    await waitFor(() => {
      expect(announcement.textContent).toContain("Статус принтера: Нет связи с принтером.");
      expect(announcement.textContent).toContain("Relay: Нет подтверждения.");
      expect(announcement.textContent).toContain("Moonraker API: Нет подтверждения.");
      expect(announcement.textContent).toContain("Восстановление: Восстанавливаем связь.");
    }, { timeout: 3_000 });
  });

  it.each([
    [
      "источник телеметрии недоступен",
      { state: "offline", live_availability_reason: "no_telemetry_channel", progress: null, metrics: {}, last_confirmed_at: null },
      "Источник телеметрии недоступен",
    ],
    [
      "принтер офлайн",
      { state: "offline", live_availability_reason: "offline", progress: 42, metrics: { nozzleTempC: 210 }, last_confirmed_at: "2026-07-15T10:00:00.000Z" },
      "Нет связи с принтером",
    ],
    [
      "данные устарели",
      { state: "printing", live_availability_reason: "stale", progress: 42, metrics: { nozzleTempC: 210 }, state_updated_at: "2026-07-15T10:00:00.000Z", last_confirmed_at: "2026-07-15T10:00:00.000Z" },
      "Данные устарели",
    ],
    [
      "принтер сообщил ошибку",
      { state: "error", live_availability_reason: "available", progress: null, metrics: {}, last_confirmed_at: "2026-07-15T10:00:00.000Z" },
      "Ошибка устройства",
    ],
  ])("отдельно сообщает, когда %s", async (_caseName, live, expected) => {
    renderLiveScreen(live);

    expect(await screen.findByText(expected)).toBeTruthy();
  });

  it("не показывает устаревшие прогресс и метрики как свежие", async () => {
    renderLiveScreen({
      state: "printing",
      live_availability_reason: "stale",
      progress: 42,
      metrics: { nozzleTempC: 210 },
      state_updated_at: "2026-07-15T10:00:00.000Z",
      last_confirmed_at: "2026-07-15T10:00:00.000Z",
    });

    await screen.findByText("Данные устарели");
    expect(screen.queryByRole("progressbar", { name: "Прогресс печати" })).toBeNull();
    expect(screen.queryByText("210°")).toBeNull();
    expect(screen.getByText(/Последнее подтверждение:/)).toBeTruthy();
  });

  it("managed-local открывает единый read-only detail без command CTA и без server→LAN пути", async () => {
    const fetchMock = renderLiveScreen(
      { result: { state: "ready" } },
      undefined,
      undefined,
      { ...basics, link_source: "ip", lan_endpoint: "192.168.1.42:7125" },
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Только просмотр" })).toBeTruthy();
    expect(screen.getByText("Готов", { exact: true })).toBeTruthy();
    expect(screen.getByText("Источник: локальный запрос", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Старт" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Пауза" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Стоп" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Проверка test job" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(loopbackHelperUrl("192.168.1.42:7125"), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://192.168.1.42"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/commands"))).toBe(false);
  });

  it("MF-1843: helper unavailable — loopback-соединение не установилось до ответа helper", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/me/printers") {
        return { ok: true, json: async () => ({ printers: [{ ...basics, link_source: "ip", lan_endpoint: "192.168.1.42:7125" }] }) };
      }
      if (url === loopbackHelperUrl("192.168.1.42:7125")) throw new Error("connection refused");
      throw new Error(`Неожиданный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterLiveScreen user={user} section="printers" onSectionChange={() => {}} id="printer-1" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Локальный helper не обнаружен" })).toBeTruthy();
    expect(screen.getByText("Источник: локальный helper", { exact: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Установить локальный helper" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Повторить проверку" })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://192.168.1.42"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/commands"))).toBe(false);
  });

  it("MF-1843: helper отвечает своей ошибкой LAN-пробы — остаётся direct timeout/error, не helper unavailable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/me/printers") {
        return { ok: true, json: async () => ({ printers: [{ ...basics, link_source: "ip", lan_endpoint: "192.168.1.42:7125" }] }) };
      }
      if (url === loopbackHelperUrl("192.168.1.42:7125")) return { ok: true, json: async () => ({}) };
      throw new Error(`Неожиданный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <PrinterLiveScreen user={user} section="printers" onSectionChange={() => {}} id="printer-1" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Не удалось проверить локальный принтер" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Локальный helper не обнаружен" })).toBeNull();
    expect(screen.getByRole("button", { name: "Повторить проверку" })).toBeTruthy();
  });

  it("после reload читает по command id authoritative executed, а не результат постановки в очередь", async () => {
    window.history.replaceState(null, "", "/printer/printer-1?command_id=command-1&printer_id=printer-1");
    renderLiveScreen(
      {
        live: true,
        state: "ready",
        live_availability_reason: "available",
        safe_test_job: true,
        execution_mode: "live",
        allowed_commands: ["query", "pause", "resume"],
        command_capabilities: { pause: true, resume: false },
        progress: null,
        metrics: {},
      },
      {
        command_id: "command-1",
        correlation_id: "correlation-1",
        device_id: "printer-1",
        command: "pause",
        status: "executed",
        code: null,
        message: null,
        timestamp: "2026-07-15T12:00:01.000Z",
      },
    );

    expect(await screen.findByText("Выполнено")).toBeTruthy();
    expect(await screen.findByText("Пауза подтверждена. Для отката продолжите test job после новой проверки статуса.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Открыть результат команды" }).getAttribute("href")).toContain("command_id=command-1");
  });

  it("для подтверждённой mock test job не предлагает старт или стоп и ставит паузу только после confirmation", async () => {
    const userEvents = userEvent.setup();
    const fetchMock = renderLiveScreen({
      live: true,
      state: "printing",
      live_availability_reason: "available",
      safe_test_job: true,
      execution_mode: "mock_only",
      allowed_commands: ["query", "pause", "resume"],
      command_capabilities: { pause: true, resume: false },
      progress: 42,
      metrics: {},
    });

    expect(await screen.findByRole("heading", { name: "Проверка test job" })).toBeTruthy();
    expect(screen.getByText("Ограниченный test job")).toBeTruthy();
    expect(screen.getByText("Mock: действия не управляют физическим принтером")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Старт" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Стоп" })).toBeNull();

    await userEvents.click(screen.getByRole("button", { name: "Поставить на паузу" }));
    const dialog = await screen.findByRole("dialog", { name: "Поставить test job на паузу?" });

    await userEvents.click(within(dialog).getByRole("button", { name: "Поставить на паузу" }));
    expect(await screen.findByText("В очереди")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/me/printers/printer-1/commands",
      expect.objectContaining({ body: JSON.stringify({ command: "pause", safe_test_job: true }) }),
    );
  });

  it("не ставит команду в очередь, когда runtime пометил test job устаревшей", async () => {
    renderLiveScreen({
      live: false,
      state: "paused",
      live_availability_reason: "stale",
      safe_test_job: true,
      execution_mode: "live",
      allowed_commands: ["query", "pause", "resume"],
      command_capabilities: { pause: false, resume: true },
      last_confirmed_at: "2026-07-15T10:00:00.000Z",
      progress: 42,
      metrics: {},
    });

    expect(await screen.findByText("Данные test job устарели")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Проверить статус" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Продолжить test job" })).toBeNull();
  });

  it("не ставит команду в очередь, когда test job офлайн", async () => {
    renderLiveScreen({
      live: false,
      state: "offline",
      live_availability_reason: "offline",
      safe_test_job: true,
      execution_mode: "live",
      allowed_commands: ["query", "pause", "resume"],
      command_capabilities: { pause: true, resume: true },
      last_confirmed_at: "2026-07-15T10:00:00.000Z",
      progress: null,
      metrics: {},
    });

    expect(await screen.findByText("Нет связи с test job")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Проверить статус" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Поставить на паузу" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Продолжить test job" })).toBeNull();
  });

  it("обновляет query через read-only snapshot, не создавая команду", async () => {
    const userEvents = userEvent.setup();
    const fetchMock = renderLiveScreen({
      live: true,
      state: "ready",
      live_availability_reason: "available",
      safe_test_job: true,
      execution_mode: "live",
      allowed_commands: ["query", "pause", "resume"],
      command_capabilities: { pause: false, resume: false },
      progress: null,
      metrics: {},
    });

    const queryButton = await screen.findByRole("button", { name: "Проверить статус" });
    const initialLiveReads = fetchMock.mock.calls.filter(([url]) => url === "/me/printers/printer-1/live").length;
    await userEvents.click(queryButton);

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === "/me/printers/printer-1/live")).toHaveLength(initialLiveReads + 1);
    });
    expect(fetchMock.mock.calls.some(([url]) => url === "/me/printers/printer-1/commands")).toBe(false);
  });

  it("показывает безопасную причину отказа без автоматического повтора", async () => {
    const userEvents = userEvent.setup();
    renderLiveScreen(
      {
        live: true,
        state: "printing",
        live_availability_reason: "available",
        safe_test_job: true,
        execution_mode: "live",
        allowed_commands: ["query", "pause", "resume"],
        command_capabilities: { pause: true, resume: false },
        progress: 42,
        metrics: {},
      },
      undefined,
      { status: 403, body: { error: "command_denied" } },
    );

    await userEvents.click(await screen.findByRole("button", { name: "Поставить на паузу" }));
    const dialog = await screen.findByRole("dialog", { name: "Поставить test job на паузу?" });
    await userEvents.click(within(dialog).getByRole("button", { name: "Поставить на паузу" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Действие не разрешено для этой test job: Команда отклонена политикой устройства.");
    expect(screen.queryByRole("button", { name: /Повторить/ })).toBeNull();
  });
});
