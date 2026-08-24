import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionUser } from "@domains/access";
import { HomeHeader, type Section } from "@platform/nav";
import "../../../pages/home/home.css";
import { useOverlay } from "@platform/overlay";
import { navigate, parkAddPath, printersPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, Button, Card, EmptyState, Eyebrow, Heading, StatusPill, type StatusTone } from "@shared/ui";
import { fetchCommandResult, isTerminalCommandResult, queuedCommandResult, rememberCommandResult, queueCommand, type CommandResultState } from "./livecommands.ts";
import { CommandStatus, type CommandStatusState } from "./commandstatus.tsx";
import { availabilityReasonOf, bindingLabel, connectionEvidence, connectionStateOf, fetchPrinterBasics, hasCommandCapability, hasFreshLiveFrame, httpPrinterLiveSource, type CredentialRejection, type LiveState, type PrinterBasics, type PrinterConnectionState, type TestJobCommand } from "./livesource.ts";
import { createEnrollCode, type EnrollCode } from "./enroll.ts";
import { EnrollCodeDisplay } from "./enrollcodepanel.tsx";
import { ManagedLocalSurface, type ManagedLocalSurfaceState } from "./managedlocalsurface.tsx";
import "./park.css";

// Живая страница принтера `/printer/:id` (MF-953, брешь №2 firmware.pilot.md эпика MF-879) —
// один принтер юзера из его парка, реальные данные (в отличие от морды MF-926 на моках,
// printerface/printerfacescreen.tsx). Не путать с `/printers/:slug` (карточка МОДЕЛИ в каталоге,
// MF-892, printers/printerdetailscreen.tsx) — здесь устройство юзера, `id` — uuid user_printers.

const PHASE_LABEL: Record<LiveState["phase"], string> = {
  printing: "Печатает",
  ready: "Готов",
  idle: "Ожидает",
  paused: "На паузе",
  error: "Ошибка",
  offline: "Офлайн",
};

const REJECTION_COPY: Record<CredentialRejection, { label: string; message: string }> = {
  invalid_token: { label: "Связь с агентом отклонена", message: "Подключение этого устройства не подтверждено. Управление недоступно." },
  unknown_agent: { label: "Связь с агентом отклонена", message: "Подключение этого устройства не подтверждено. Управление недоступно." },
  revoked: { label: "Доступ агента отозван", message: "Для этого устройства нужна повторная авторизация." },
};

const CONTROL_COMMANDS = ["start", "pause", "stop"] as const;
const CONNECTION_REASON_ID = "printer-connection-reason";
type ControlCommand = (typeof CONTROL_COMMANDS)[number];
const CONTROL_COMMAND_LABEL: Record<ControlCommand, string> = { start: "Старт", pause: "Пауза", stop: "Стоп" };
const SAFE_TEST_JOB_COMMANDS = new Set<TestJobCommand>(["query", "pause", "resume"]);
const TEST_JOB_ACTIONS = ["pause", "resume"] as const;
type TestJobAction = (typeof TEST_JOB_ACTIONS)[number];
type PrinterControlCommand = ControlCommand | TestJobAction;
const TEST_JOB_ACTION_COPY: Record<TestJobAction, { button: string; title: string; confirm: string }> = {
  pause: { button: "Поставить на паузу", title: "Поставить test job на паузу?", confirm: "Поставить на паузу" },
  resume: { button: "Продолжить test job", title: "Продолжить test job?", confirm: "Продолжить test job" },
};
const TEST_JOB_DENIAL_COPY = {
  command_denied: "Команда отклонена политикой устройства.",
  safe_test_job_required: "Не подтверждён обязательный safe marker.",
  role_forbidden: "Текущая роль не разрешает это действие.",
  unknown_command: "Контракт не распознал действие.",
} as const;
type TestJobDenialCode = keyof typeof TEST_JOB_DENIAL_COPY;

function isPrinterControlCommand(command: string | null): command is PrinterControlCommand {
  return command === "start" || command === "pause" || command === "resume" || command === "stop";
}

function hasConfirmedTestJobContract(live: LiveState | null): boolean {
  const allowedCommands = live?.testJobAllowedCommands;
  return live?.safeTestJob === true
    && (live.testJobExecutionMode === "live" || live.testJobExecutionMode === "mock_only")
    && Array.isArray(allowedCommands)
    && allowedCommands.includes("query")
    && allowedCommands.every((command) => SAFE_TEST_JOB_COMMANDS.has(command as TestJobCommand));
}

function testJobSurfaceState(live: LiveState | null): "available" | "unavailable" | "stale" | "offline" {
  if (availabilityReasonOf(live) === "stale") return "stale";
  if (!hasFreshLiveFrame(live)) return "offline";
  return hasConfirmedTestJobContract(live) ? "available" : "unavailable";
}

// tone/pulse — тот же словарь statusов, что overlay/severity.ts использует для алертов принтера
// (не завожу второй набор тонов рядом, offline и dim — одна ветка "нет связи").
export function toneForPhase(phase: LiveState["phase"]): { tone: StatusTone; pulse?: boolean } {
  switch (phase) {
    case "printing":
      return { tone: "ok", pulse: true };
    case "ready":
    case "idle":
      return { tone: "ok" };
    case "paused":
      return { tone: "warn" };
    case "error":
      return { tone: "danger", pulse: true };
    case "offline":
      return { tone: "dim" };
  }
}

type LiveStatusKind = "normal" | "source-unavailable" | "offline" | "stale" | "source-error" | "permission-denied" | "device-error";

interface LiveStatusPresentation {
  kind: LiveStatusKind;
  label: string;
  message: string | null;
  nextStep: string | null;
  tone: StatusTone;
  lastConfirmedAt: string | null;
}

type ConnectionActionKind = "enroll" | "access-instructions" | "refresh" | "moonraker-instructions";

interface ConnectionStatePresentation {
  state: PrinterConnectionState;
  label: string;
  reason: string;
  action: string;
  actionKind: ConnectionActionKind;
  tone: StatusTone;
}

const CONNECTION_STATE_PRESENTATION: Record<PrinterConnectionState, ConnectionStatePresentation> = {
  "firmware-ready": {
    state: "firmware-ready",
    label: "Можно подключить принтер",
    reason: "Каталог подтвердил готовность firmware-пути, но связь с устройством ещё не подтверждена.",
    action: "Подключить принтер",
    actionKind: "enroll",
    tone: "dim",
  },
  "awaiting-access": {
    state: "awaiting-access",
    label: "Ждём доступ к принтеру",
    reason: "Enroll-код выдан, но агент ещё не подтвердил привязку; credential не считается активным.",
    action: "Показать инструкцию подключения",
    actionKind: "access-instructions",
    tone: "dim",
  },
  enrolling: {
    state: "enrolling",
    label: "Подключаем принтер…",
    reason: "Агент начал enrollment, но ещё не подтвердил health и credential.",
    action: "Проверить статус подключения",
    actionKind: "refresh",
    tone: "warn",
  },
  "relay-offline": {
    state: "relay-offline",
    label: "Нет связи с порталом",
    reason: "Agent-факт может быть свежим, но relay/session отсутствует или устарел.",
    action: "Проверить связь",
    actionKind: "refresh",
    tone: "warn",
  },
  "moonraker-unavailable": {
    state: "moonraker-unavailable",
    label: "Moonraker недоступен",
    reason: "Агент и relay могут быть доступны, но проверка Moonraker неуспешна или устарела.",
    action: "Открыть инструкцию проверки Moonraker",
    actionKind: "moonraker-instructions",
    tone: "warn",
  },
  "recovery-required": {
    state: "recovery-required",
    label: "Подключение требует восстановления",
    reason: "Credential отозван, недействителен или факты подключения противоречат друг другу.",
    action: "Подключить заново",
    actionKind: "enroll",
    tone: "danger",
  },
};

export function connectionStatePresentation(live: LiveState | null): ConnectionStatePresentation | null {
  if (!live?.connectionState) return null;
  return CONNECTION_STATE_PRESENTATION[connectionStateOf(live)];
}

function managedLocalSurfaceState(
  basics: Pick<PrinterBasics, "linkSource" | "lanEndpoint">,
  live: LiveState | null,
): ManagedLocalSurfaceState | null {
  const managedLocal = basics.linkSource === "ip" || live?.connectionMode === "managed-local";
  if (!managedLocal) return null;
  if (!basics.lanEndpoint && basics.linkSource === "ip" && !live) return "not-configured";
  // MF-1843: соединение к loopback-helper не установилось ДО его ответа — отдельно от
  // `no_telemetry_channel` (ещё нет ни одного тика) и от `direct-error` (helper ответил).
  if (live && availabilityReasonOf(live) === "helper_unavailable") return "helper-unavailable";
  if (!live || availabilityReasonOf(live) === "no_telemetry_channel") return "lan-only";
  if (live.rejection || availabilityReasonOf(live) === "permission_denied") return "permission-unknown";
  if (availabilityReasonOf(live) === "server_error" || availabilityReasonOf(live) === "offline") return "direct-error";
  if (hasFreshLiveFrame(live) && live.phase === "ready") return "ready-detail";
  return "unknown";
}

function lastConfirmedAt(live: LiveState | null): string | null {
  return live?.lastConfirmedAt ?? live?.updatedAt ?? null;
}

function formatConfirmedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "время неизвестно";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date);
}

// Внутри каждой ветки один честный исход и один следующий шаг. Кнопки команд здесь намеренно
// не меняются: их capability/очередь — отдельный контур, а этот слой отвечает только за
// доступность свежей телеметрии (MF-1246).
export function liveStatusPresentation(live: LiveState | null, basics: Pick<PrinterBasics, "linkSource">): LiveStatusPresentation {
  const confirmedAt = lastConfirmedAt(live);
  const reason = availabilityReasonOf(live);

  if (!live || reason === "no_telemetry_channel") {
    const localOnly = live?.connectionMode === "managed-local" || (live?.connectionMode == null && basics.linkSource === "ip");
    return localOnly
      ? {
          kind: "source-unavailable",
          label: "Локальный статус не подтверждён",
          message: "Этот принтер доступен только в вашей локальной сети; удалённого канала нет.",
          nextStep: "Следующий шаг: подключитесь к сети принтера и проверьте Moonraker.",
          tone: "dim",
          lastConfirmedAt: confirmedAt,
        }
      : {
          kind: "source-unavailable",
          label: "Источник телеметрии недоступен",
          message: "Портал ещё не получил канал телеметрии этого принтера.",
          nextStep: "Следующий шаг: подключите агент, чтобы передавать статус в портал.",
          tone: "dim",
          lastConfirmedAt: confirmedAt,
        };
  }

  if (reason === "offline") {
    return {
      kind: "offline",
      label: "Нет связи с принтером",
      message: "Принтер не подтвердил текущее состояние.",
      nextStep: "Следующий шаг: проверьте питание и подключение принтера.",
      tone: "dim",
      lastConfirmedAt: confirmedAt,
    };
  }

  if (reason === "stale") {
    return {
      kind: "stale",
      label: "Данные устарели",
      message: "Портал получил старый снимок состояния; это не живая телеметрия.",
      nextStep: "Следующий шаг: дождитесь нового подтверждения статуса.",
      tone: "warn",
      lastConfirmedAt: confirmedAt,
    };
  }

  if (reason === "permission_denied") {
    return {
      kind: "permission-denied",
      label: "Доступ к источнику статуса ограничен",
      message: "Портал не может подтвердить состояние этого принтера.",
      nextStep: "Следующий шаг: обратитесь к владельцу устройства.",
      tone: "warn",
      lastConfirmedAt: confirmedAt,
    };
  }

  if (reason === "server_error") {
    return {
      kind: "source-error",
      label: "Ошибка источника статуса",
      message: "Портал не получил подтверждённый статус принтера.",
      nextStep: "Следующий шаг: повторите проверку чуть позже.",
      tone: "warn",
      lastConfirmedAt: confirmedAt,
    };
  }

  if (live.phase === "error") {
    return {
      kind: "device-error",
      label: "Ошибка устройства",
      message: "Принтер подтвердил состояние ошибки.",
      nextStep: "Следующий шаг: проверьте принтер на месте.",
      tone: "danger",
      lastConfirmedAt: confirmedAt,
    };
  }

  return {
    kind: "normal",
    label: PHASE_LABEL[live.phase],
    message: null,
    nextStep: null,
    tone: toneForPhase(live.phase).tone,
    lastConfirmedAt: confirmedAt,
  };
}

function TempRow({ label, temp }: { label: string; temp: LiveState["nozzle"] }) {
  if (!temp) return null;
  return (
    <div className="printerLiveTemp" data-tone={temp.tone}>
      <span className="printerLiveTempLabel">{label}</span>
      <span className="printerLiveTempValue">{Math.round(temp.value)}°</span>
    </div>
  );
}

export function PrinterLiveScreen({
  user,
  section,
  onSectionChange,
  id,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  id: string;
}) {
  const [basics, setBasics] = useState<PrinterBasics | null | undefined>(undefined);
  const [live, setLive] = useState<LiveState | null>(null);
  const [hadLiveFrame, setHadLiveFrame] = useState(false);
  const [sending, setSending] = useState<Set<PrinterControlCommand>>(new Set());
  const [commandStatuses, setCommandStatuses] = useState<Partial<Record<PrinterControlCommand, CommandStatusState>>>({});
  const [activeCommandId, setActiveCommandId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("command_id"));
  const [enroll, setEnroll] = useState<EnrollCode | null>(null);
  const [enrollStatus, setEnrollStatus] = useState<"idle" | "loading" | "offline" | "expired">("idle");
  const [liveRefresh, setLiveRefresh] = useState(0);
  const [refreshingTestJob, setRefreshingTestJob] = useState(false);
  const [testJobDenial, setTestJobDenial] = useState<TestJobDenialCode | null>(null);
  const [connectionActionResult, setConnectionActionResult] = useState<string | null>(null);
  const [showAccessInstructions, setShowAccessInstructions] = useState(false);
  const [showMoonrakerInstructions, setShowMoonrakerInstructions] = useState(false);
  const overlay = useOverlay();
  const sound = useInteractionSound();
  const commandSoundStates = useRef(new Map<string, CommandResultState["kind"]>());
  useEffect(() => {
    let cancelled = false;
    fetchPrinterBasics(id).then((result) => {
      if (!cancelled) setBasics(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!basics) return;
    const source = httpPrinterLiveSource();
    return source.subscribe(id, (next) => {
      setLive((previous) => {
        if (previous?.live && !next.live) setHadLiveFrame(true);
        if (next.live) {
          setEnroll(null);
          setEnrollStatus("idle");
        }
        return next;
      });
      setRefreshingTestJob(false);
    }, basics?.lanEndpoint);
  }, [id, basics, liveRefresh]);

  const refreshCommandResult = useCallback(async (commandId: string, fallbackCommand?: PrinterControlCommand) => {
    const result = await fetchCommandResult(id, commandId);
    const command = isPrinterControlCommand(result.command) ? result.command : fallbackCommand;
    if (command) setCommandStatuses((previous) => ({ ...previous, [command]: result }));
    const previousSoundState = commandSoundStates.current.get(commandId);
    if (previousSoundState !== result.kind) {
      commandSoundStates.current.set(commandId, result.kind);
      if (result.kind === "executed" && previousSoundState !== "queued") sound.success();
      else if (result.kind === "failed" || result.kind === "expired") sound.error();
      else if (result.kind === "offline") sound.offline();
    }
    return result;
  }, [id, sound]);

  useEffect(() => {
    if (!activeCommandId) return;
    let cancelled = false;
    let retry: number | undefined;
    const poll = async () => {
      const result = await refreshCommandResult(activeCommandId);
      if (!cancelled && !isTerminalCommandResult(result) && result.kind !== "offline") {
        retry = window.setTimeout(() => void poll(), 2_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [activeCommandId, refreshCommandResult]);

  async function startRecovery() {
    setActiveCommandId(null);
    setEnrollStatus("loading");
    const code = await createEnrollCode();
    if (!code) {
      sound.offline();
      setEnrollStatus("offline");
      return;
    }
    sound.success();
    setEnroll(code);
    setEnrollStatus("idle");
    window.setTimeout(() => {
      if (new Date(code.expiresAt).getTime() <= Date.now()) {
        setEnroll(null);
        setEnrollStatus("expired");
      }
    }, Math.max(0, new Date(code.expiresAt).getTime() - Date.now()));
  }

  function refreshTestJobStatus() {
    setTestJobDenial(null);
    setRefreshingTestJob(true);
    setLiveRefresh((value) => value + 1);
  }

  function refreshConnectionStatus(state: PrinterConnectionState) {
    setConnectionActionResult(
      state === "enrolling"
        ? "Статус подключения перечитан; подтверждение агента всё ещё ожидается."
        : "Проверен новый факт relay; подтверждённый сеанс пока не получен.",
    );
    setLiveRefresh((value) => value + 1);
  }

  async function runConnectionAction(presentation: ConnectionStatePresentation) {
    setConnectionActionResult(null);
    if (presentation.actionKind === "enroll") {
      await startRecovery();
      return;
    }
    if (presentation.actionKind === "access-instructions") {
      setShowAccessInstructions(true);
      return;
    }
    if (presentation.actionKind === "moonraker-instructions") {
      setShowMoonrakerInstructions(true);
      return;
    }
    refreshConnectionStatus(presentation.state);
  }

  async function sendCommand(command: ControlCommand) {
    setSending((prev) => new Set(prev).add(command));
    const result = await queueCommand(id, command);
    if (result.ok) {
      rememberCommandResult(id, result.commandId);
      const queued = queuedCommandResult(id, result.commandId, command);
      commandSoundStates.current.set(result.commandId, queued.kind);
      sound.success();
      setCommandStatuses((previous) => ({ ...previous, [command]: queued }));
      setActiveCommandId(result.commandId);
    } else {
      if (result.reason === "network") sound.offline();
      else sound.error();
      setCommandStatuses((previous) => ({ ...previous, [command]: { kind: "queue-failed", reason: result.reason } }));
    }
    setSending((prev) => {
      const next = new Set(prev);
      next.delete(command);
      return next;
    });
  }

  async function sendTestJobCommand(command: TestJobAction) {
    setSending((prev) => new Set(prev).add(command));
    setTestJobDenial(null);
    const result = await queueCommand(id, command, { safe_test_job: true });
    if (result.ok) {
      rememberCommandResult(id, result.commandId);
      const queued = queuedCommandResult(id, result.commandId, command);
      commandSoundStates.current.set(result.commandId, queued.kind);
      sound.success();
      setCommandStatuses((previous) => ({ ...previous, [command]: queued }));
      setActiveCommandId(result.commandId);
    } else if (result.code) {
      sound.error();
      setTestJobDenial(result.code);
    } else {
      if (result.reason === "network") sound.offline();
      else sound.error();
      setCommandStatuses((previous) => ({ ...previous, [command]: { kind: "queue-failed", reason: result.reason } }));
    }
    setSending((prev) => {
      const next = new Set(prev);
      next.delete(command);
      return next;
    });
  }

  async function confirmTestJobCommand(command: TestJobAction) {
    const copy = TEST_JOB_ACTION_COPY[command];
    const confirmed = await overlay.confirm({
      title: copy.title,
      message: "Действие затрагивает только подтверждённую test job. Запуск и остановка печати не предлагаются.",
      confirmLabel: copy.confirm,
      cancelLabel: "Назад",
    });
    if (confirmed) await sendTestJobCommand(command);
  }

  const header = (
    <div style={{ position: "relative", zIndex: 30 }}>
      <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} onBack={() => navigate(printersPath())} />
    </div>
  );

  if (basics === undefined) return null;

  if (basics === null) {
    return (
      <div className="home">
        <AuroraBackground />
        {header}
        <main className="homeContent">
          <EmptyState icon={<span aria-hidden="true">?</span>} title="Принтер не найден" sub="Проверьте, что он в вашем парке." />
        </main>
      </div>
    );
  }

  const managedLocalState = managedLocalSurfaceState(basics, live);
  if (managedLocalState) {
    return (
      <div className="home">
        <AuroraBackground />
        {header}
        <main className="homeContent">
          <ManagedLocalSurface
            state={managedLocalState}
            printerName={`${basics.brand} ${basics.model}`.trim()}
            setupHref={parkAddPath({ brand: basics.brand, model: basics.model })}
            onProbe={() => {
              setLive(null);
              setLiveRefresh((value) => value + 1);
            }}
          />
        </main>
      </div>
    );
  }

  const phase = live?.phase ?? "offline";
  const { pulse: phasePulse } = toneForPhase(phase);
  const connectionStatus = connectionStatePresentation(live);
  const rejection = live?.rejection ? REJECTION_COPY[live.rejection] : null;
  const status = liveStatusPresentation(live, basics);
  const statusLabel = connectionStatus?.label ?? rejection?.label ?? status.label;
  const statusTone = connectionStatus?.tone ?? (rejection ? "warn" : status.tone);
  const statusPulse = !connectionStatus && !rejection && (status.kind === "normal" || status.kind === "device-error") ? phasePulse : false;
  const statusMessage = connectionStatus?.reason ?? rejection?.message ?? status.message;
  const statusNextStep = connectionStatus || rejection ? null : status.nextStep;
  const statusLastConfirmedAt = connectionStatus || rejection ? null : status.lastConfirmedAt;
  const hasFreshTelemetry = hasFreshLiveFrame(live);
  const evidence = connectionEvidence(basics, live, hadLiveFrame);
  const connectionAnnouncement = [
    `Статус принтера: ${statusLabel}.`,
    `Прошивка: ${evidence.firmware.label}.`,
    `Агент enrollment: ${evidence.enrollment.label}.`,
    `Relay: ${evidence.relay.label}.`,
    `Moonraker API: ${evidence.moonraker.label}.`,
    `Восстановление: ${evidence.recovery.label}.`,
  ].join(" ");
  const canSendCommand = (command: ControlCommand) => !connectionStatus && hasFreshTelemetry && !rejection && hasCommandCapability(live, command);
  const hasTestJob = !connectionStatus && live?.safeTestJob === true;
  const safeTestJobState = hasTestJob ? testJobSurfaceState(live) : null;
  const confirmedTestJob = hasConfirmedTestJobContract(live);
  const testJobMode = live?.testJobExecutionMode ?? null;
  const canRunTestJobAction = (command: TestJobAction) => safeTestJobState === "available"
    && confirmedTestJob
    && !rejection
    && live?.testJobAllowedCommands?.includes(command) === true
    && hasCommandCapability(live, command);
  const activeTestJobActions = TEST_JOB_ACTIONS.filter(canRunTestJobAction);
  const rollbackFeedback = TEST_JOB_ACTIONS.find((command) => commandStatuses[command]?.kind === "executed");

  return (
    <div className="home">
      <AuroraBackground />
      {header}
      <main className="homeContent">
        <div className="printerLivePage">
          <Eyebrow>Мой принтер</Eyebrow>
          <Heading size="md">{`${basics.brand} ${basics.model}`.trim()}</Heading>
          <div className="printerLiveSub">{bindingLabel(basics.linkSource)}</div>

          <Card className="printerLiveCard">
            <div className="printerLiveStatusRow">
              <StatusPill tone={statusTone} pulse={statusPulse}>
                {statusLabel}
              </StatusPill>
              {statusMessage ? (
                <div className="printerLiveStatusCopy" role={connectionStatus?.state === "recovery-required" || rejection || status.kind === "device-error" ? "alert" : "status"}>
                  <span id={connectionStatus ? CONNECTION_REASON_ID : undefined}>{statusMessage}</span>
                  {statusLastConfirmedAt ? <time className="printerLiveTimestamp" dateTime={statusLastConfirmedAt}>Последнее подтверждение: {formatConfirmedAt(statusLastConfirmedAt)}</time> : null}
                  {statusNextStep ? <span className="printerLiveNextStep">{statusNextStep}</span> : null}
                </div>
              ) : null}
            </div>

            {connectionStatus ? (
              <div className="printerLiveRecovery">
                <Button
                  variant="primary"
                  onPointerDown={sound.confirm}
                  onClick={() => void runConnectionAction(connectionStatus)}
                  disabled={connectionStatus.actionKind === "enroll" && enrollStatus === "loading"}
                  loading={connectionStatus.actionKind === "enroll" && enrollStatus === "loading"}
                >
                  {connectionStatus.action}
                </Button>
                {enroll ? <EnrollCodeDisplay code={enroll.code} installCommand={enroll.installCommand} /> : null}
                {showAccessInstructions && connectionStatus.state === "awaiting-access" ? (
                  live?.enrollCode
                    ? <EnrollCodeDisplay code={live.enrollCode.code} installCommand={live.enrollCode.installCommand} />
                    : <p className="printerLiveHint">Текущий enroll-код недоступен. Получите новый код только после явного восстановления подключения.</p>
                ) : null}
                {showMoonrakerInstructions && connectionStatus.state === "moonraker-unavailable" ? <p className="printerLiveHint">Проверьте локально, что сервис Moonraker запущен и доступен агенту.</p> : null}
                {connectionActionResult ? <p className="printerLiveHint" role="status">{connectionActionResult}</p> : null}
                {enrollStatus === "offline" ? <p className="printerLiveHint">Нет связи с порталом. Повторите попытку вручную.</p> : enrollStatus === "expired" ? <p className="printerLiveHint">Код истёк.</p> : null}
              </div>
            ) : rejection && (basics.linkSource === "agent" || basics.linkSource === "custom") ? (
              <div className="printerLiveRecovery" role="alert" aria-live="assertive">
                {enroll ? <EnrollCodeDisplay code={enroll.code} installCommand={enroll.installCommand} /> : null}
                {!enroll ? <Button variant="primary" onPointerDown={sound.confirm} onClick={() => void startRecovery()} disabled={enrollStatus === "loading"}>{enrollStatus === "loading" ? "Создаём новый код…" : enrollStatus === "expired" ? "Сгенерировать новый" : "Подключить заново"}</Button> : null}
                {enrollStatus === "offline" ? <p className="printerLiveHint">Нет связи с порталом. Повторите попытку.</p> : enrollStatus === "expired" ? <p className="printerLiveHint">Код истёк.</p> : null}
              </div>
            ) : rejection ? <p className="printerLiveHint">Обратитесь к владельцу устройства</p> : null}

            {hasFreshTelemetry && live && phase === "printing" ? (
              <div className="printerLiveProgress">
                <div className="printerLiveProgressTrack" role="progressbar" aria-label="Прогресс печати" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(live.progress ?? 0)}>
                  <div className="printerLiveProgressFill" style={{ width: `${Math.min(100, Math.max(0, live.progress ?? 0))}%` }} />
                </div>
                <span className="printerLiveProgressValue">{Math.round(live.progress ?? 0)}%</span>
              </div>
            ) : null}

            {hasFreshTelemetry && live ? (
              <div className="printerLiveTemps">
                <TempRow label="Сопло" temp={live.nozzle} />
                <TempRow label="Стол" temp={live.bed} />
                <TempRow label="Камера" temp={live.chamber} />
              </div>
            ) : null}
          </Card>

          <Card className="printerLiveEvidence" aria-label="Состояние подключения">
            <Heading size="md">Доказательства подключения</Heading>
            <dl className="printerLiveEvidenceList">
              {Object.entries({
                "Прошивка": evidence.firmware,
                "Агент enrollment": evidence.enrollment,
                "Relay": evidence.relay,
                "Moonraker API": evidence.moonraker,
                "Восстановление": evidence.recovery,
              }).map(([label, state]) => (
                <div className="printerLiveEvidenceRow" key={label}>
                  <dt>{label}</dt>
                  <dd><StatusPill tone={state.tone}>{state.label}</StatusPill></dd>
                </div>
              ))}
            </dl>
            <p className="printerLiveHint">«Подтверждена» и «Доступен» появляются только после ответа от API принтера через агент и relay.</p>
          </Card>

          <p className="printerLiveAnnouncement" role="status" aria-live="polite" aria-atomic="true" aria-label="Обновления состояния подключения">
            {connectionAnnouncement}
          </p>

          {hasTestJob ? (
            <Card className="printerTestJob" aria-describedby="printer-test-job-reason">
              <div className="printerTestJobHeader">
                <div>
                  <Heading size="md">Проверка test job</Heading>
                  <p className="printerTestJobMeta">Ограниченный test job</p>
                </div>
                {testJobMode === "mock_only" ? <StatusPill tone="warn">Mock: действия не управляют физическим принтером</StatusPill> : <StatusPill tone="dim">Live test job</StatusPill>}
              </div>

              <p className="printerTestJobRestriction">Разрешены только проверка статуса, пауза и продолжение.</p>
              <p className="printerTestJobExcluded">Запуск, остановка, cancel, G-code и upload не входят в test job.</p>

              <div id="printer-test-job-reason" className="printerTestJobReason" role={testJobDenial ? "alert" : "status"} aria-live={testJobDenial ? "assertive" : "polite"}>
                {testJobDenial
                  ? `Действие не разрешено для этой test job: ${TEST_JOB_DENIAL_COPY[testJobDenial]}`
                  : safeTestJobState === "stale"
                    ? "Данные test job устарели"
                    : safeTestJobState === "offline"
                      ? "Нет связи с test job"
                      : safeTestJobState === "unavailable"
                        ? "Управление test job пока недоступно. Нужен подтверждённый safe marker и список разрешённых действий."
                        : testJobMode === "mock_only"
                          ? "Проверка mock: результат не подтверждает работу физического принтера."
                          : "Доступно только действие, подтверждённое текущим снимком test job."}
              </div>

              <div className="printerTestJobControls">
                <Button
                  variant="secondary"
                  icon={null}
                  loading={refreshingTestJob}
                  onPointerDown={sound.confirm}
                  onClick={refreshTestJobStatus}
                >
                  {refreshingTestJob ? "Проверяем статус…" : "Проверить статус"}
                </Button>
                {activeTestJobActions.map((command) => {
                  const statusForCommand = commandStatuses[command] ?? null;
                  const waitingForConfirmation = statusForCommand?.kind === "queued" || statusForCommand?.kind === "acknowledged";
                  const copy = TEST_JOB_ACTION_COPY[command];
                  return (
                    <div className="printerTestJobAction" key={command}>
                      <Button
                        variant="primary"
                        icon={null}
                        aria-describedby="printer-test-job-reason"
                        disabled={waitingForConfirmation || sending.has(command)}
                        loading={sending.has(command)}
                        onPointerDown={sound.confirm}
                        onClick={() => void confirmTestJobCommand(command)}
                      >
                        {copy.button}
                      </Button>
                      <CommandStatus
                        command={copy.confirm}
                        status={statusForCommand}
                        canRetry={false}
                        onRetry={() => {
                          if (statusForCommand?.kind === "offline") refreshTestJobStatus();
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {rollbackFeedback === "pause" ? <p className="printerTestJobRollback" role="status">Пауза подтверждена. Для отката продолжите test job после новой проверки статуса.</p> : null}
              {rollbackFeedback === "resume" ? <p className="printerTestJobRollback" role="status">Продолжение подтверждено. Проверьте статус, чтобы подтвердить rollback.</p> : null}
            </Card>
          ) : (
            <div className="printerLiveControls">
              {CONTROL_COMMANDS.map((command) => {
                const statusForCommand = commandStatuses[command] ?? (canSendCommand(command) ? undefined : { kind: "read-only" as const });
                const waitingForConfirmation = statusForCommand?.kind === "queued" || statusForCommand?.kind === "acknowledged";
                const commandAvailable = canSendCommand(command);
                return (
                  <div className="printerLiveControl" key={command}>
                    <Button
                      variant="secondary"
                      icon={null}
                      aria-describedby={connectionStatus ? CONNECTION_REASON_ID : undefined}
                      disabled={!commandAvailable || waitingForConfirmation || sending.has(command)}
                      loading={sending.has(command)}
                      onPointerDown={sound.confirm}
                      onClick={() => void sendCommand(command)}
                    >
                      {CONTROL_COMMAND_LABEL[command]}
                    </Button>
                    <CommandStatus
                      command={CONTROL_COMMAND_LABEL[command]}
                      status={statusForCommand ?? null}
                      canRetry={commandAvailable}
                      onRetry={() => {
                        if (statusForCommand?.kind === "offline") void refreshCommandResult(statusForCommand.commandId, command);
                        else void sendCommand(command);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
