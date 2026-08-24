// Гейтинг плиток уровня мастера «добавить принтер» (MF-903, docs/design/printer.wizard.md §3.3).
// Чистые функции без побочных эффектов — тестируются напрямую (addwizard.test.tsx), UI
// (leveltiles.tsx) только читает результат.

export type LevelId = "list" | "managed-local" | "managed-cloud" | "managed-bridge" | "custom";

export const LEVEL_IDS: LevelId[] = ["list", "managed-local", "managed-cloud", "managed-bridge", "custom"];

// Протокол managed-подключения модели (миграция 20260710440000_printer_support_levels.sql):
// null — ещё не классифицирован ("неизвестное не молчит", product/ux.md §5), 'none' — подтверждённо
// нет открытого API (Marlin и т.п.).
export type ConnectorType = "moonraker" | "bambu-mqtt" | "prusa-link" | "octoprint" | "vendor-cloud" | "none" | null;

// Поля модели из канона `printers` (§0 схема-опора), нужные гейтингу. Все опциональны/nullable —
// GET /printers (MF-884, Data) на момент этой карточки ещё не сериализует connector_type/
// firmware_ready/firmware_public в ответе (колонки в БД уже есть, API — нет, см. printercanon.ts).
// Гейтинг читает их defensively: отсутствующее поле трактуется как "не классифицировано", а не
// падает — как только Data досериализует ответ, гейтинг заработает без изменений здесь.
export interface PrinterCanonInfo {
  connectorType?: ConnectorType;
  firmwareReady?: boolean;
  firmwarePublic?: boolean;
}

export type GateReasonKind = "model" | "soon";

export interface GateResult {
  enabled: boolean;
  reasonKind?: GateReasonKind;
  reason?: string;
}

const LOCAL_CONNECTORS: ConnectorType[] = ["moonraker", "prusa-link", "octoprint"];
// В v1 bridge — это наш Moonraker-агент. Наличие другого локального API не означает,
// что агент уже умеет его оборачивать (не смешиваем гейт модели и обещание roadmap).
const BRIDGE_CONNECTORS: ConnectorType[] = ["moonraker"];

// Причина «недоступно этой модели» для managed-local/managed-bridge — общая, т.к. оба уровня
// в v1 гейтятся одним и тем же протоколом (§3.3 «managed-bridge — светится, если наш агент
// умеет обернуть протокол модели (v1 = moonraker, как и managed-local)»).
function localConnectorReason(connector: ConnectorType | undefined): GateResult {
  if (connector === "none") {
    return {
      enabled: false,
      reasonKind: "model",
      reason: "Недоступно этой модели: прошивка не даёт локального доступа к принтеру",
    };
  }
  // null/undefined — протокол ещё не классифицирован ресёрчерами. Честно показываем как
  // «недоступно», не выдумывая связь, но текст отличает «не собрали данные» от «точно нет».
  return {
    enabled: false,
    reasonKind: "model",
    reason: "Недоступно этой модели: данные о протоколе подключения ещё не собраны",
  };
}

function customReason(connector: ConnectorType | undefined, firmwareReady: boolean): GateResult {
  if (connector === "none") {
    return {
      enabled: false,
      reasonKind: "model",
      reason: "Недоступно этой модели: прошивка Marlin не поддерживает нашу кастомную сборку",
    };
  }
  if (!firmwareReady) {
    return {
      enabled: false,
      reasonKind: "soon",
      reason: "Скоро: сборка нашей прошивки под эту модель ещё не готова",
    };
  }
  return { enabled: true };
}

export function computeGating(info: PrinterCanonInfo | null): Record<LevelId, GateResult> {
  const connector = info?.connectorType;
  const localOk = connector != null && LOCAL_CONNECTORS.includes(connector);
  const firmwareReady = info?.firmwareReady === true;

  return {
    list: { enabled: true },
    "managed-local": localOk ? { enabled: true } : localConnectorReason(connector),
    // v1: облако вендора приглушено ГЛОБАЛЬНО, гейт не зависит от модели (§3.3).
    "managed-cloud": {
      enabled: false,
      reasonKind: "soon",
      reason: "Скоро: облако вендора едет в v2, пока недоступно",
    },
    "managed-bridge": connector != null && BRIDGE_CONNECTORS.includes(connector) ? { enabled: true } : localConnectorReason(connector),
    custom: customReason(connector, firmwareReady),
  };
}

// §3.3 «если managed-*/custom не светится НИ ОДИН — под плитками сразу видны два выхода §5».
export function allManagedUnavailable(gating: Record<LevelId, GateResult>): boolean {
  return !gating["managed-local"].enabled && !gating["managed-cloud"].enabled && !gating["managed-bridge"].enabled && !gating.custom.enabled;
}

export interface LevelCopy {
  title: string;
  gives: string;
  // «Чем ограничено» (§3.2) — честная подпись при ВКЛЮЧЁННОЙ плитке; при выключенной подпись
  // заменяется причиной гейта (GateResult.reason), см. leveltiles.tsx.
  limitation: string;
}

export const LEVEL_COPY: Record<LevelId, LevelCopy> = {
  list: {
    title: "Просто отметить",
    gives: "В парке для сравнения, каталог сообщества",
    limitation: "Управления нет",
  },
  "managed-local": {
    title: "Управлять, пока дома",
    gives: "Полный контроль: статус, старт/пауза/стоп, G-code",
    limitation: "Работает только в вашей сети — вне дома принтер офлайн",
  },
  "managed-cloud": {
    title: "Управлять из любой точки, через вендора",
    gives: "Опрос через облако производителя, прошивку не трогаем",
    limitation: "Идёт через облако вендора, прошивку не трогаем",
  },
  "managed-bridge": {
    title: "Управлять из любой точки, через наш агент",
    gives: "Маленький сервис рядом с принтером, работает за NAT",
    limitation: "Нужно установить агент (несколько минут)",
  },
  custom: {
    title: "Полный портал на принтере",
    gives: "Наш визуал+агент на экране принтера, двусторонняя связь",
    limitation: "Приватная прошивка — доступ по запросу",
  },
};
