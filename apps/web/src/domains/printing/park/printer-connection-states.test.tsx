import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { PrinterLiveScreen } from "./printerlivescreen.tsx";
import { printerConnectionStateFixtures, type ConnectionStateFixture } from "./connectionstates.fixtures.ts";

const user = { id: "user-1", username: "maker", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function renderConnectionState(fixture: ConnectionStateFixture) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/me/printers") return { ok: true, json: async () => ({ printers: [fixture.basics] }) };
    if (url === `/me/printers/${fixture.basics.id}/live`) return { ok: true, json: async () => fixture.live };
    if (url === "/me/devices/enroll-codes" && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ code: "MF1669-ENROLL", expires_at: new Date(Date.now() + 60_000).toISOString(), install_command: "install-agent --code MF1669-ENROLL" }),
      };
    }
    throw new Error(`Неожиданный запрос fixture ${fixture.key}: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ThemeProvider>
      <OverlayProvider>
        <PrinterLiveScreen user={user} section="printers" onSectionChange={() => {}} id={fixture.basics.id} />
      </OverlayProvider>
    </ThemeProvider>,
  );

  return fetchMock;
}

function expectDangerousCommands(disabled: boolean) {
  for (const name of ["Старт", "Пауза", "Стоп"]) {
    expect(screen.getByRole("button", { name })).toHaveProperty("disabled", disabled);
  }
}

function expectBlockedCommandsDescribe(reasonId: string) {
  for (const name of ["Старт", "Пауза", "Стоп"]) {
    expect(screen.getByRole("button", { name }).getAttribute("aria-describedby")).toBe(reasonId);
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MF-1665: матрица шести состояний подключения", () => {
  it.each(printerConnectionStateFixtures)("$key: точный статус, причина, единственное действие и запрет команд", async (fixture) => {
    renderConnectionState(fixture);

    expect(await screen.findByText(fixture.expected.status, { exact: true })).toBeTruthy();
    expect(screen.getByText(fixture.expected.reason, { exact: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: fixture.expected.action })).toHaveProperty("disabled", false);

    expectDangerousCommands(fixture.expected.dangerousCommands === "disabled");
    expect(screen.queryByText("Готов", { exact: true })).toBeNull();
  });

  it.each(printerConnectionStateFixtures)("$key: причина блокировки доступна вместе с опасными командами", async (fixture) => {
    renderConnectionState(fixture);

    const reason = await screen.findByText(fixture.expected.reason, { exact: true });
    expect(reason.getAttribute("id")).toBe("printer-connection-reason");
    expectBlockedCommandsDescribe("printer-connection-reason");
  });

  it.each(printerConnectionStateFixtures.filter(({ expected }) => expected.actionKind === "enroll"))(
    "$key: выдаёт новый enroll-код и не открывает опасные команды",
    async (fixture) => {
      const userEvents = userEvent.setup();
      const fetchMock = renderConnectionState(fixture);

      await userEvents.click(await screen.findByRole("button", { name: fixture.expected.action }));
      expect(await screen.findByText("MF1669-ENROLL", { exact: true })).toBeTruthy();
      expectDangerousCommands(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "/me/devices/enroll-codes",
        expect.objectContaining({ method: "POST", body: "{}" }),
      );
    },
  );

  it.each(printerConnectionStateFixtures.filter(({ expected }) => expected.actionKind === "refresh"))(
    "$key: перечитывает нормализованный факт без создания команды",
    async (fixture) => {
      const userEvents = userEvent.setup();
      const fetchMock = renderConnectionState(fixture);

      await userEvents.click(await screen.findByRole("button", { name: fixture.expected.action }));
      await waitFor(() => {
        expect(fetchMock.mock.calls.filter(([url]) => url === `/me/printers/${fixture.basics.id}/live`).length).toBeGreaterThan(1);
      });
      expect(screen.getByText(fixture.expected.outcome, { exact: true })).toBeTruthy();
      expect(fetchMock.mock.calls.some(([url]) => url === `/me/printers/${fixture.basics.id}/commands`)).toBe(false);
    },
  );

  it.each(printerConnectionStateFixtures.filter(({ expected }) => expected.actionKind === "access-instructions" || expected.actionKind === "moonraker-instructions"))(
    "$key: показывает безопасный ожидаемый результат действия",
    async (fixture) => {
      const userEvents = userEvent.setup();
      renderConnectionState(fixture);

      await userEvents.click(await screen.findByRole("button", { name: fixture.expected.action }));
      expect(await screen.findByText(fixture.expected.outcome, { exact: true })).toBeTruthy();
    },
  );

  it.each([
    ["незнакомый ключ", { connection_state: "connected" }],
    ["нормализованный факт без timestamp", { last_confirmed_at: null }],
    ["противоречивый firmware-факт", { connection_state: "firmware-ready", state: "ready", live: true, live_availability_reason: "available" }],
  ])("%s переводит экран в fail-closed recovery", async (_caseName, conflictingLive) => {
    const firmware = printerConnectionStateFixtures.find(({ key }) => key === "firmware-ready");
    if (!firmware) throw new Error("Матрица MF-1669 неполна");

    renderConnectionState({ ...firmware, live: { ...firmware.live, ...conflictingLive } });

    expect(await screen.findByText("Подключение требует восстановления", { exact: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Подключить заново" })).toHaveProperty("disabled", false);
    expectDangerousCommands(true);
    expect(screen.queryByText("Готов", { exact: true })).toBeNull();
  });
});
