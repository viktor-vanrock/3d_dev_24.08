/**
 * MF-1665: воспроизводимая матрица шести состояний подключения.
 *
 * Это данные API, а не внутренние props React-компонента: тесты прогоняют тот же
 * mapping, который получает `/printer/:id` из `/me/printers` и `/live`.
 */
export type ConnectionStateFixture = {
  key: "firmware-ready" | "awaiting-access" | "enrolling" | "relay-offline" | "moonraker-unavailable" | "recovery-required";
  label: string;
  basics: {
    id: string;
    brand: string;
    model: string;
    link_source: string;
    firmware_ready?: boolean | null;
  };
  live: Record<string, unknown>;
  expected: {
    status: string;
    reason: string;
    action: string;
    outcome: string;
    dangerousCommands: "enabled" | "disabled";
    actionKind: "enroll" | "access-instructions" | "refresh" | "moonraker-instructions";
  };
};

const EMPTY_METRICS = { metrics: {}, progress: null, last_confirmed_at: "2026-07-15T18:00:00.000Z" };

export const printerConnectionStateFixtures: ConnectionStateFixture[] = [
  {
    key: "firmware-ready",
    label: "готова только firmware-ветка",
    basics: { id: "printer-ready", brand: "Creality", model: "Ender-3 V3 KE", link_source: "manual", firmware_ready: true },
    live: {
      live: false,
      state: "offline",
      connection_state: "firmware-ready",
      command_capabilities: { start: true, pause: true, stop: true },
      ...EMPTY_METRICS,
    },
    expected: {
      status: "Можно подключить принтер",
      reason: "Каталог подтвердил готовность firmware-пути, но связь с устройством ещё не подтверждена.",
      action: "Подключить принтер",
      outcome: "MF1669-ENROLL",
      dangerousCommands: "disabled",
      actionKind: "enroll",
    },
  },
  {
    key: "awaiting-access",
    label: "выдан enroll-код, но агент ещё не подтвердил привязку",
    basics: { id: "printer-awaiting-access", brand: "Creality", model: "Ender-3 V3 KE", link_source: "agent", firmware_ready: true },
    live: {
      state: "offline",
      connection_state: "awaiting-access",
      enroll_code: { code: "MF1669-AWAIT", expires_at: "2026-07-16T12:00:00.000Z", install_command: "install-agent --code MF1669-AWAIT" },
      command_capabilities: { start: true, pause: true, stop: true },
      ...EMPTY_METRICS,
    },
    expected: {
      status: "Ждём доступ к принтеру",
      reason: "Enroll-код выдан, но агент ещё не подтвердил привязку; credential не считается активным.",
      action: "Показать инструкцию подключения",
      outcome: "MF1669-AWAIT",
      dangerousCommands: "disabled",
      actionKind: "access-instructions",
    },
  },
  {
    key: "enrolling",
    label: "агент начал enrollment без подтверждённого health-факта",
    basics: { id: "printer-enrolling", brand: "Creality", model: "Ender-3 V3 KE", link_source: "agent", firmware_ready: true },
    live: { state: "offline", connection_state: "enrolling", command_capabilities: { start: true, pause: true, stop: true }, ...EMPTY_METRICS },
    expected: {
      status: "Подключаем принтер…",
      reason: "Агент начал enrollment, но ещё не подтвердил health и credential.",
      action: "Проверить статус подключения",
      outcome: "Статус подключения перечитан; подтверждение агента всё ещё ожидается.",
      dangerousCommands: "disabled",
      actionKind: "refresh",
    },
  },
  {
    key: "relay-offline",
    label: "relay offline",
    basics: { id: "printer-relay-offline", brand: "Creality", model: "Ender-3 V3 KE", link_source: "agent", firmware_ready: true },
    live: { state: "offline", connection_state: "relay-offline", command_capabilities: { start: true, pause: true, stop: true }, ...EMPTY_METRICS },
    expected: {
      status: "Нет связи с порталом",
      reason: "Agent-факт может быть свежим, но relay/session отсутствует или устарел.",
      action: "Проверить связь",
      outcome: "Проверен новый факт relay; подтверждённый сеанс пока не получен.",
      dangerousCommands: "disabled",
      actionKind: "refresh",
    },
  },
  {
    key: "moonraker-unavailable",
    label: "Moonraker unavailable",
    basics: { id: "printer-moonraker-unavailable", brand: "Creality", model: "Ender-3 V3 KE", link_source: "agent", firmware_ready: true },
    live: { state: "offline", connection_state: "moonraker-unavailable", command_capabilities: { start: true, pause: true, stop: true }, ...EMPTY_METRICS },
    expected: {
      status: "Moonraker недоступен",
      reason: "Агент и relay могут быть доступны, но проверка Moonraker неуспешна или устарела.",
      action: "Открыть инструкцию проверки Moonraker",
      outcome: "Проверьте локально, что сервис Moonraker запущен и доступен агенту.",
      dangerousCommands: "disabled",
      actionKind: "moonraker-instructions",
    },
  },
  {
    key: "recovery-required",
    label: "требуется повторная авторизация агента",
    basics: { id: "printer-recovery-required", brand: "Creality", model: "Ender-3 V3 KE", link_source: "agent", firmware_ready: true },
    live: { state: "offline", connection_state: "recovery-required", reason: "revoked", command_capabilities: { start: true, pause: true, stop: true }, ...EMPTY_METRICS },
    expected: {
      status: "Подключение требует восстановления",
      reason: "Credential отозван, недействителен или факты подключения противоречат друг другу.",
      action: "Подключить заново",
      outcome: "MF1669-ENROLL",
      dangerousCommands: "disabled",
      actionKind: "enroll",
    },
  },
];
