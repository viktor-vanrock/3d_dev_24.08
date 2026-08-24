// Живая страница принтера `/printer/:id` (MF-953, брешь №2 firmware.pilot.md). Канал relay →
// device_state/device_telemetry пишет данные (MF-843, apps/device-agent/readme.md), читаем их
// сессионным зеркалом `GET /me/printers/:id/live` (MF-957, apps/api/src/profile/activation.ts) —
// requireUserId вместо API-key, тот же join, что публичный `GET /v0/printers/:id`. Источник
// спроектирован под push с первого дня (интерфейс `subscribe`, не `fetchOnce`) — если Back
// заменит короткий поллинг на SSE/WS, меняется только тело `httpPrinterLiveSource`, экран
// (printerlivescreen.tsx) не трогаем.
//
// 404/сетевая ошибка (устройство ещё не активировано на бэке, сеть упала) — источник это ЧЕСТНО
// показывает (live:false), не выдуманные метрики: тот же принцип, что оффлайн-деградация §2.5
// printer.face.md.

export type LivePhase = "printing" | "ready" | "idle" | "paused" | "error" | "offline";
export type LiveAvailabilityReason = "available" | "no_telemetry_channel" | "offline" | "stale" | "permission_denied" | "server_error" | "helper_unavailable";
export type LiveConnectionMode = "list" | "managed-local" | "managed-bridge";
export type CommandCapabilityName = "gcode" | "start" | "pause" | "resume" | "stop" | "cancel";
export type TestJobCommand = "query" | "pause" | "resume";
export type TestJobExecutionMode = "live" | "mock_only";
export type PrinterConnectionState = "firmware-ready" | "awaiting-access" | "enrolling" | "relay-offline" | "moonraker-unavailable" | "recovery-required";

const COMMAND_CAPABILITY_NAMES = new Set<CommandCapabilityName>(["gcode", "start", "pause", "resume", "stop", "cancel"]);
const TEST_JOB_EXECUTION_MODES = new Set<TestJobExecutionMode>(["live", "mock_only"]);
const PRINTER_CONNECTION_STATES = new Set<PrinterConnectionState>([
  "firmware-ready",
  "awaiting-access",
  "enrolling",
  "relay-offline",
  "moonraker-unavailable",
  "recovery-required",
]);

const LIVE_AVAILABILITY_REASONS = new Set<LiveAvailabilityReason>([
  "available",
  "no_telemetry_channel",
  "offline",
  "stale",
  "permission_denied",
  "server_error",
  "helper_unavailable",
]);
const LIVE_CONNECTION_MODES = new Set<LiveConnectionMode>(["list", "managed-local", "managed-bridge"]);

// Под-уровень привязки конкретного устройства юзера (printer.wizard.md §3.2/§1.3 — не свойство
// каталога, свойство ЭТОЙ привязки). Данных для точного различения managed-local/managed-bridge
// на user_printers сегодня нет (link_source знает только connector/popular/search/manual/agent/ip,
// см. apps/api/db/schema.sql) — bindingLabel() ниже честно даёт лучшее доступное приближение.
export type BindingLevel = "list" | "managed-local" | "managed-bridge" | "custom" | "unknown";

export interface LiveTemp {
  value: number;
  tone: "ok" | "warn";
}

export interface LiveState {
  phase: LivePhase;
  progress: number | null;
  nozzle: LiveTemp | null;
  bed: LiveTemp | null;
  chamber: LiveTemp | null;
  jobId: string | null;
  updatedAt: string | null;
  // true — контракт отдал реальный кадр; false — эндпоинта ещё нет (см. комментарий файла) или
  // сеть упала. Экран рисует РАЗНЫЙ текст для «принтер офлайн» и «данные ещё не подключены» —
  // не мешаем их в одно "offline", хотя визуально оба tone="dim".
  live: boolean;
  // Нормализованная причина доступности из operating-контракта MF-1244. Поле опционально для
  // старого endpoint-а: до появления причины экран сохраняет безопасную деградацию live:false.
  availabilityReason?: LiveAvailabilityReason | null;
  // Время последнего подтверждённого кадра. Это не синоним текущего HTTP-ответа: stale не
  // становится свежим только потому, что API вернул старый snapshot.
  lastConfirmedAt?: string | null;
  connectionMode?: LiveConnectionMode | null;
  commandCapabilities?: Partial<Record<CommandCapabilityName, boolean>> | null;
  rejection?: CredentialRejection | null;
  // Поля ограниченного QA-контракта MF-1539. До их появления на session endpoint
  // экран не выводит режим из имени принтера, роли либо обычной capability.
  safeTestJob?: boolean | null;
  testJobExecutionMode?: TestJobExecutionMode | null;
  testJobAllowedCommands?: string[] | null;
  // Source of truth из UX-контракта MF-1667. Старая ручка не присылает это поле,
  // поэтому undefined оставляет старый read-only экран до миграции endpoint-а.
  connectionState?: PrinterConnectionState | null;
  enrollCode?: LiveEnrollCode | null;
}

export interface LiveEnrollCode {
  code: string;
  expiresAt: string;
  installCommand: string;
}

export type CredentialRejection = "invalid_token" | "unknown_agent" | "revoked";

const CREDENTIAL_REJECTIONS = new Set<CredentialRejection>(["invalid_token", "unknown_agent", "revoked"]);

export function safeCredentialRejection(value: unknown): CredentialRejection | null {
  return typeof value === "string" && CREDENTIAL_REJECTIONS.has(value as CredentialRejection) ? (value as CredentialRejection) : null;
}

export function safeLiveAvailabilityReason(value: unknown): LiveAvailabilityReason | null {
  return typeof value === "string" && LIVE_AVAILABILITY_REASONS.has(value as LiveAvailabilityReason) ? (value as LiveAvailabilityReason) : null;
}

export function safeLiveConnectionMode(value: unknown): LiveConnectionMode | null {
  return typeof value === "string" && LIVE_CONNECTION_MODES.has(value as LiveConnectionMode) ? (value as LiveConnectionMode) : null;
}

export function safePrinterConnectionState(value: unknown): PrinterConnectionState | null {
  return typeof value === "string" && PRINTER_CONNECTION_STATES.has(value as PrinterConnectionState)
    ? value as PrinterConnectionState
    : null;
}

function safeTestJobExecutionMode(value: unknown): TestJobExecutionMode | null {
  return typeof value === "string" && TEST_JOB_EXECUTION_MODES.has(value as TestJobExecutionMode) ? (value as TestJobExecutionMode) : null;
}

function safeTestJobAllowedCommands(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((command) => typeof command === "string") ? value : null;
}

function safeLiveEnrollCode(value: unknown): LiveEnrollCode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { code?: unknown; expires_at?: unknown; install_command?: unknown };
  if (typeof raw.code !== "string" || typeof raw.expires_at !== "string" || typeof raw.install_command !== "string") return null;
  return { code: raw.code, expiresAt: raw.expires_at, installCommand: raw.install_command };
}

function normalizedConnectionState(
  value: unknown,
  { live, availabilityReason, rejection, lastConfirmedAt }: Pick<LiveState, "live" | "availabilityReason" | "rejection" | "lastConfirmedAt">,
): PrinterConnectionState {
  const state = safePrinterConnectionState(value);
  if (!state || rejection || typeof lastConfirmedAt !== "string" || Number.isNaN(Date.parse(lastConfirmedAt))) return "recovery-required";
  if ((state === "firmware-ready" || state === "awaiting-access" || state === "enrolling") && live) return "recovery-required";
  if ((state === "relay-offline" || state === "moonraker-unavailable") && availabilityReason === "available") return "recovery-required";
  return state;
}

export function connectionStateOf(state: LiveState | null | undefined): PrinterConnectionState {
  return state?.connectionState ?? "recovery-required";
}

export function availabilityReasonOf(state: LiveState | null | undefined): LiveAvailabilityReason {
  if (state?.availabilityReason) return state.availabilityReason;
  return state?.live ? "available" : "no_telemetry_channel";
}

export function hasFreshLiveFrame(state: LiveState | null | undefined): boolean {
  return state?.live === true && availabilityReasonOf(state) === "available";
}

// Возможность неизвестна = запрещено. managed-local не получает server-side подтверждение,
// поэтому веб не должен превращать локальный канал в удалённое управление.
export function hasCommandCapability(state: LiveState | null | undefined, command: CommandCapabilityName): boolean {
  return state?.connectionMode !== "managed-local" && state?.commandCapabilities?.[command] === true;
}

function safeCommandCapabilities(value: unknown): Partial<Record<CommandCapabilityName, boolean>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name, enabled]) => COMMAND_CAPABILITY_NAMES.has(name as CommandCapabilityName) && typeof enabled === "boolean")
      .map(([name, enabled]) => [name, enabled]),
  ) as Partial<Record<CommandCapabilityName, boolean>>;
}

function offlineState(
  previous: LiveState | undefined,
  rejection: CredentialRejection | null = null,
  availabilityReason: LiveAvailabilityReason = "server_error",
): LiveState {
  return {
    phase: "offline",
    progress: previous?.progress ?? null,
    nozzle: previous?.nozzle ?? null,
    bed: previous?.bed ?? null,
    chamber: previous?.chamber ?? null,
    jobId: previous?.jobId ?? null,
    updatedAt: previous?.updatedAt ?? null,
    live: false,
    availabilityReason,
    lastConfirmedAt: previous?.lastConfirmedAt ?? previous?.updatedAt ?? null,
    connectionMode: previous?.connectionMode ?? null,
    commandCapabilities: previous?.commandCapabilities ?? null,
    rejection,
    safeTestJob: previous?.safeTestJob ?? null,
    testJobExecutionMode: previous?.testJobExecutionMode ?? null,
    testJobAllowedCommands: previous?.testJobAllowedCommands ?? null,
    connectionState: previous?.connectionState === "recovery-required" ? "recovery-required" : "relay-offline",
    enrollCode: previous?.enrollCode ?? null,
  };
}

export interface PrinterBasics {
  id: string;
  brand: string;
  model: string;
  linkSource: string;
  lanEndpoint?: string | null;
  firmwareReady?: boolean | null;
}

export type EvidenceTone = "ok" | "warn" | "dim";

export interface ConnectionEvidence {
  firmware: { label: string; tone: EvidenceTone };
  enrollment: { label: string; tone: EvidenceTone };
  relay: { label: string; tone: EvidenceTone };
  moonraker: { label: string; tone: EvidenceTone };
  recovery: { label: string; tone: EvidenceTone };
}

// Публичный UI не повышает состояние без физического/API-доказательства. Пока API не
// присылает firmware_ready, это намеренно «не подтверждено», а не «готово».
export function connectionEvidence(
  basics: Pick<PrinterBasics, "firmwareReady" | "linkSource">,
  live: LiveState | null,
  hadLiveFrame: boolean,
): ConnectionEvidence {
  const fresh = hasFreshLiveFrame(live);
  const managedLocal = live?.connectionMode === "managed-local" || (live?.connectionMode == null && basics.linkSource === "ip");
  return {
    firmware:
      basics.firmwareReady === true
        ? { label: "Подтверждена", tone: "ok" }
        : basics.firmwareReady === false
          ? { label: "Не готова", tone: "warn" }
          : { label: "Не подтверждена", tone: "dim" },
    enrollment: basics.linkSource === "agent" ? { label: "Агент привязан", tone: "ok" } : { label: "Ожидает агента", tone: "dim" },
    // LAN-only — это browser→Moonraker, не удалённый relay-канал. Не повышаем локальную
    // проверку до «на связи» с порталом, даже если /printer/info ответил успешно.
    relay: managedLocal ? { label: "Не используется локально", tone: "dim" } : fresh ? { label: "На связи", tone: "ok" } : { label: "Нет подтверждения", tone: "dim" },
    moonraker: managedLocal
      ? fresh
        ? { label: "Доступен локально", tone: "ok" }
        : { label: "Локально не подтверждён", tone: "dim" }
      : fresh
        ? { label: "Доступен", tone: "ok" }
        : { label: "Нет подтверждения", tone: "dim" },
    recovery: fresh
      ? { label: hadLiveFrame ? "Восстановлено" : "Стабильно", tone: hadLiveFrame ? "ok" : "dim" }
      : { label: hadLiveFrame ? "Восстанавливаем связь" : "Ожидание подключения", tone: hadLiveFrame ? "warn" : "dim" },
  };
}

export interface PrinterLiveSource {
  subscribe(deviceId: string, onUpdate: (state: LiveState) => void, lanEndpoint?: string | null): () => void;
}

import { apiFetch } from "@shared/api";

// Совпадает с throttle агента (1 кадр/сек/устройство, device-agent/readme.md) — опрашиваем не
// чаще источника, смысла в более частом поллинге нет.
const POLL_INTERVAL_MS = 2000;

// Loopback-helper (MF-1841 §2.2.5, решение Design-UX MF-1842, handoff MF-1843): HTTPS mixed
// content блокирует прямой browser→LAN fetch (доказано MF-1835), поэтому браузер обращается к
// helper-процессу на loopback вместо LAN IP принтера напрямую — helper сам делает LAN-запрос.
// Порт/путь ниже — сторона Front (сам helper-компонент вне scope этой карточки, владение
// Devices/UltraPrint); при появлении отдельного контракта меняется только `loopbackHelperUrl`.
const LOOPBACK_HELPER_PORT = 8943;
const LOOPBACK_HELPER_TIMEOUT_MS = 3000;

export function loopbackHelperUrl(lanEndpoint: string): string {
  return `http://127.0.0.1:${LOOPBACK_HELPER_PORT}/probe?target=${encodeURIComponent(lanEndpoint)}`;
}

// Различитель `helper unavailable` vs `direct timeout/error` (printer.surface-states.md §2/§5а)
// живёт целиком на уровне этого fetch: если соединение к loopback не устанавливается
// (refused/timeout ДО ответа) — fetch() отклоняется, ниже это ловит catch в tick(). Если helper
// ответил — хотя бы с ошибкой собственного LAN-запроса — Response долетает до вызывающего кода и
// разбирается тем же путём, что раньше разбирал прямой LAN-ответ.
function fetchLoopbackHelper(lanEndpoint: string): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LOOPBACK_HELPER_TIMEOUT_MS);
  return fetch(loopbackHelperUrl(lanEndpoint), { signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

function toTemp(raw: unknown): LiveTemp | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // Порог warn — тот же, что мок-морда (printerface/facesource.ts) сегодня не формализует тон
  // сервером; держим нейтральный "ok" до появления реального порога в контракте (metrics — jsonb
  // без интерпретации на бэке, device-agent/readme.md), не выдумываем правило раньше Back/Design.
  return { value: raw, tone: "ok" };
}

function phaseFromStatus(status: string | null | undefined): LivePhase {
  switch (status) {
    case "printing":
    case "ready":
    case "idle":
    case "paused":
    case "error":
      return status;
    default:
      return "offline";
  }
}

// Живой источник — поллинг session-эндпоинта `GET /me/printers/:id/live` (MF-957). 404/сетевая
// ошибка — не «принтер офлайн», а «канал ещё не подключён»: экран получает live:false и рисует
// честную подпись, не тон "офлайн устройства".
export function httpPrinterLiveSource(): PrinterLiveSource {
  return {
    subscribe(deviceId, onUpdate, lanEndpoint) {
      let stopped = false;
      let previous: LiveState | undefined;

      function emit(state: LiveState) {
        previous = state;
        onUpdate(state);
      }

      async function tick() {
        if (stopped) return;
        try {
          const response = lanEndpoint
            ? await fetchLoopbackHelper(lanEndpoint)
            : await apiFetch(`/me/printers/${encodeURIComponent(deviceId)}/live`, { credentials: "include" });
          if (!response.ok) {
            let rejection: CredentialRejection | null = null;
            let availabilityReason: LiveAvailabilityReason = response.status === 404 ? "no_telemetry_channel" : "server_error";
            let connectionState: PrinterConnectionState = "recovery-required";
            try {
              const body = (await response.json()) as { reason?: unknown; credential_reason?: unknown; error?: unknown; live_availability_reason?: unknown; connection_state?: unknown };
              rejection = safeCredentialRejection(body.reason) ?? safeCredentialRejection(body.credential_reason) ?? safeCredentialRejection(body.error);
              availabilityReason = safeLiveAvailabilityReason(body.live_availability_reason) ?? availabilityReason;
              connectionState = normalizedConnectionState(body.connection_state, { live: false, availabilityReason, rejection, lastConfirmedAt: null });
            } catch {
              // Безопасная причина необязательна: не выдаём сырое тело ответа.
            }
            emit({ ...offlineState(previous, rejection, availabilityReason), connectionState });
            return;
          }
          const data = (await response.json()) as {
            result?: { state?: string };
            live?: unknown;
            state?: string;
            progress?: number | null;
            metrics?: Record<string, unknown>;
            job_id?: string | null;
            state_updated_at?: string | null;
            last_confirmed_at?: string | null;
            connection_mode?: unknown;
            command_capabilities?: unknown;
            live_availability_reason?: unknown;
            reason?: unknown;
            credential_reason?: unknown;
            safe_test_job?: unknown;
            execution_mode?: unknown;
            allowed_commands?: unknown;
            connection_state?: unknown;
            enroll_code?: unknown;
          };
          if (lanEndpoint) {
            emit({
              phase: data.result?.state === "ready" ? "ready" : "offline",
              progress: null,
              nozzle: null,
              bed: null,
              chamber: null,
              jobId: null,
              updatedAt: null,
              live: Boolean(data.result),
              availabilityReason: data.result ? "available" : "offline",
              lastConfirmedAt: null,
              connectionMode: "managed-local",
              commandCapabilities: null,
              rejection: null,
            });
            return;
          }
          const metrics = data.metrics ?? {};
          const availabilityReason = safeLiveAvailabilityReason(data.live_availability_reason) ?? (data.state === "offline" ? "offline" : "available");
          const rejection = safeCredentialRejection(data.reason) ?? safeCredentialRejection(data.credential_reason);
          const live = data.live !== false && availabilityReason === "available";
          const hasConnectionState = Object.hasOwn(data, "connection_state");
          emit({
            phase: phaseFromStatus(data.state),
            progress: typeof data.progress === "number" ? data.progress : null,
            nozzle: toTemp(metrics.nozzleTempC),
            bed: toTemp(metrics.bedTempC),
            chamber: toTemp(metrics.chamberTempC),
            jobId: data.job_id ?? null,
            updatedAt: data.state_updated_at ?? null,
            live,
            availabilityReason,
            lastConfirmedAt: data.last_confirmed_at ?? data.state_updated_at ?? null,
            connectionMode: safeLiveConnectionMode(data.connection_mode),
            commandCapabilities: safeCommandCapabilities(data.command_capabilities),
            rejection,
            safeTestJob: typeof data.safe_test_job === "boolean" ? data.safe_test_job : null,
            testJobExecutionMode: safeTestJobExecutionMode(data.execution_mode),
            testJobAllowedCommands: safeTestJobAllowedCommands(data.allowed_commands),
            connectionState: hasConnectionState
              ? normalizedConnectionState(data.connection_state, { live, availabilityReason, rejection, lastConfirmedAt: data.last_confirmed_at ?? data.state_updated_at ?? null })
              : null,
            enrollCode: safeLiveEnrollCode(data.enroll_code),
          });
        } catch {
          // lanEndpoint: соединение к loopback-helper не установилось (refused/timeout) ДО его
          // ответа — `helper unavailable`, а не `direct timeout/error` (см. комментарий у
          // fetchLoopbackHelper выше). Без lanEndpoint поведение не меняется.
          emit(
            lanEndpoint
              ? { ...offlineState(previous), connectionMode: "managed-local", availabilityReason: "helper_unavailable" }
              : offlineState(previous),
          );
        }
      }

      void tick();
      const timer = window.setInterval(tick, POLL_INTERVAL_MS);
      return () => {
        stopped = true;
        window.clearInterval(timer);
      };
    },
  };
}

export async function fetchPrinterBasics(deviceId: string): Promise<PrinterBasics | null> {
  try {
    const response = await apiFetch(`/me/printers`, { credentials: "include" });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      printers?: { id: string; brand: string; model: string; link_source: string; lan_endpoint?: string | null; firmware_ready?: boolean | null }[];
    };
    const row = (data.printers ?? []).find((printer) => printer.id === deviceId);
    if (!row) return null;
    return {
      id: row.id,
      brand: row.brand,
      model: row.model,
      linkSource: row.link_source,
      lanEndpoint: row.lan_endpoint ?? null,
      firmwareReady: row.firmware_ready ?? null,
    };
  } catch {
    return null;
  }
}

// Подпись под-уровня (§1.3 printer.face.md — мельче, второй строкой, не отдельный бейдж) —
// best-effort по имеющимся полям link_source, см. комментарий типа BindingLevel выше.
export function bindingLabel(linkSource: string): string {
  switch (linkSource) {
    case "agent":
      return "Через наш агент";
    case "ip":
      return "Локально, в вашей сети";
    case "manual":
    case "popular":
    case "search":
      return "Просто отмечен в парке";
    case "connector":
      return "Через облако производителя";
    default:
      return "Привязка неизвестна";
  }
}
