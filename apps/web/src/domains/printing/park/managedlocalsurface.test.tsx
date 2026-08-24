import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@platform/theme";
import { ManagedLocalSurface, type ManagedLocalSurfaceState } from "./managedlocalsurface.tsx";

type SurfaceFixture = {
  state: ManagedLocalSurfaceState;
  heading: string;
  source: string;
  sourceCaption?: string;
  reason: string;
  action?: string;
  suppressLanBadge?: boolean;
};

const fixtures: SurfaceFixture[] = [
  { state: "ready-detail", heading: "Только просмотр", source: "Источник: локальный запрос", reason: "Готов означает только успешный локальный запрос." },
  { state: "lan-only", heading: "Только в вашей сети", source: "Источник: локальное подключение", reason: "Браузер подключается к принтеру напрямую." , action: "Проверить связь" },
  { state: "direct-error", heading: "Не удалось проверить локальный принтер", source: "Источник: ошибка локального запроса", reason: "Ошибка прямого запроса из браузера.", action: "Повторить проверку" },
  {
    state: "helper-unavailable",
    heading: "Локальный helper не обнаружен",
    source: "Источник: локальный helper",
    sourceCaption: "Проверка ограничена этим устройством",
    reason: "Портал не смог подключиться к локальному helper на этом устройстве. Обычно это значит, что helper не установлен или не запущен; сама проверка принтера в LAN ещё не выполнялась.",
    action: "Установить локальный helper",
    suppressLanBadge: true,
  },
  { state: "permission-unknown", heading: "Права доступа не подтверждены", source: "Источник: права не подтверждены", reason: "Текущее состояние принтера не подтверждено." },
  { state: "unknown", heading: "Состояние неизвестно", source: "Источник состояния не подтверждён", reason: "Источник состояния не подтверждён." },
  { state: "not-configured", heading: "Состояние неизвестно", source: "Источник: локальное подключение", reason: "Локальное подключение не настроено.", action: "Настроить локальное подключение" },
];

function renderSurface(state: ManagedLocalSurfaceState, onProbe = vi.fn()) {
  render(
    <ThemeProvider>
      <ManagedLocalSurface
        state={state}
        printerName="Creality Ender-3 V3 KE"
        setupHref="/park/add?brand=Creality&model=Ender-3+V3+KE"
        onProbe={onProbe}
      />
    </ThemeProvider>,
  );
  return onProbe;
}

afterEach(cleanup);

describe("MF-1683: reusable managed-local read-only surface", () => {
  it.each(fixtures)("$state: показывает факт, LAN-границу и не более одного допустимого действия", ({ state, heading, source, sourceCaption, reason, action, suppressLanBadge }) => {
    renderSurface(state);

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(source, { exact: true })).toBeTruthy();
    if (sourceCaption) expect(screen.getByText(sourceCaption, { exact: true })).toBeTruthy();
    expect(screen.getByText(reason, { exact: true })).toBeTruthy();
    if (suppressLanBadge) {
      expect(screen.queryByText("Только в вашей сети", { exact: true })).toBeNull();
    } else {
      expect(screen.getAllByText("Только в вашей сети", { exact: true }).length).toBeGreaterThan(0);
    }

    const actions = [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")];
    expect(actions).toHaveLength(action ? 1 : 0);
    if (action) expect(actions[0]?.textContent).toContain(action);

    // DOM-порядок (printer.surface-states.md §5а «P0-handoff», printer.surface-a11y.md §1):
    // heading → источник/граница → причина/данные → CTA.
    const bodyText = document.body.textContent ?? "";
    const headingIdx = bodyText.indexOf(heading);
    const sourceIdx = bodyText.indexOf(source);
    const reasonIdx = bodyText.indexOf(reason);
    expect(headingIdx).toBeLessThan(sourceIdx);
    expect(sourceIdx).toBeLessThan(reasonIdx);
    if (action) expect(reasonIdx).toBeLessThan(bodyText.indexOf(action));

    for (const forbidden of ["Старт", "Пауза", "Стоп", "G-code", "Камера", "Загрузить файл"]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
      expect(document.body.textContent).not.toContain(forbidden);
    }
  });

  it("MF-1843: helper unavailable отличается от direct timeout/error и не запускает пробу по клику", async () => {
    const user = userEvent.setup();
    const onProbe = renderSurface("helper-unavailable");

    expect(screen.getByText("Источник: локальный helper", { exact: true })).toBeTruthy();
    expect(screen.getByText("Проверка ограничена этим устройством", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Источник: ошибка локального запроса")).toBeNull();
    expect(screen.queryByText("Ошибка прямого запроса из браузера.")).toBeNull();
    expect(document.body.textContent).not.toMatch(/принтер офлайн/i);

    await user.click(screen.getByRole("button", { name: "Установить локальный helper" }));
    expect(onProbe).not.toHaveBeenCalled();
  });

  it.each(["lan-only", "direct-error"] as const)("%s: повторяет только direct probe", async (state) => {
    const user = userEvent.setup();
    const onProbe = renderSurface(state);

    await user.click(screen.getByRole("button", { name: state === "lan-only" ? "Проверить связь" : "Повторить проверку" }));

    expect(onProbe).toHaveBeenCalledTimes(1);
  });

  it("ready detail показывает локальный ready-факт, но не превращает его в remote-online", () => {
    renderSurface("ready-detail");

    expect(screen.getByText("Готов", { exact: true })).toBeTruthy();
    expect(screen.getByText("Источник: локальный запрос", { exact: true })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/удалённо доступен|онлайн из любой точки|управление доступно/i);
  });

  it("MF-1837: direct-error не повторяет фразу причины дважды подряд", () => {
    renderSurface("direct-error");

    expect(screen.getByText("Источник: ошибка локального запроса", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("Ошибка прямого запроса из браузера", { exact: false })).toHaveLength(1);
  });

  it("not configured ведёт только в разрешённый шаг локальной настройки", () => {
    renderSurface("not-configured");

    expect(screen.getByRole("link", { name: "Настроить локальное подключение" }).getAttribute("href"))
      .toBe("/park/add?brand=Creality&model=Ender-3+V3+KE");
  });
});
