import { useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@shared/types";
import { useActivation, type PrinterPatch, type UserPrinter } from "@shared/lib";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 4.2): printing→onboarding PrinterEditForm/printerLabel, развязка отложена до pages/DI. См. MIGRATION.md.
import { PrinterEditForm, printerLabel } from "@domains/onboarding";
import { useOverlay } from "@platform/overlay";
import { headerModeFor, navigate, parkAddPath, printerDevicePath } from "../../../router.ts";
import { AuroraBackground, ActionCard, Button, EmptyState, FlagshipBadge, Heading, PrinterIcon, StatusPill, type StatusTone } from "@shared/ui";
import { SUPPORT_LEVEL_LABEL, SUPPORT_LEVEL_LEVEL, SUPPORT_LEVEL_TONE, supportPresentationFor, type SupportPresentation } from "../printers/labels.ts";
import { pilotInfoFor, type PilotInfo } from "./firmwarepilot.ts";
import { hasCommandCapability, httpPrinterLiveSource, type CommandCapabilityName, type LiveState } from "./livesource.ts";
import "./park.css";
import { findPrinterCanon, type PrinterCanonMatch } from "./printercanon.ts";

// Список парка `/park` (MF-1077, docs/design/park.md §1) — единственная поверхность, откуда юзер
// видит ВСЕ свои принтеры разом. НЕ вторая control-панель: тап по managed/custom-строке ведёт на
// уже существующий `/printer/:id` (printerlivescreen.tsx, MF-953), тап по `list`-строке открывает
// ту же модалку редактирования, что «Мои принтеры» ЛК (market/profile.catalogs.tsx) — переиспользуем
// её форму (PrinterEditForm) вместо третьего маршрута (§1.1).

const CONTROL_CAPABILITIES: CommandCapabilityName[] = ["gcode", "start", "pause", "resume", "stop", "cancel"];

// `link_source` описывает лишь прошлый путь добавления записи. Уровень модели и способ
// подключения конкретного устройства читаем только из явных полей двух контрактов.
function badgeLevelFor(canon: PrinterCanonMatch | null): SupportPresentation {
  return supportPresentationFor(canon?.supportLevel, canon?.firmwareReady);
}

function managedAreaFor(live: LiveState | null): string {
  if (live?.connectionMode === "managed-bridge") return "Через ваш агент";
  return "Режим подключения уточняется";
}

function hasManagementCapability(live: LiveState | null): boolean {
  return CONTROL_CAPABILITIES.some((capability) => hasCommandCapability(live, capability));
}

// tone/pulse словарь строки соединения (§2.2) — 1:1 копия toneForPhase() printerlivescreen.tsx,
// не второй набор тонов (спека прямо запрещает изобретать пятое состояние).
function toneForPhase(phase: LiveState["phase"]): { tone: StatusTone; pulse?: boolean } {
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

const PHASE_LABEL: Record<LiveState["phase"], string> = {
  printing: "Печатает",
  ready: "На связи",
  idle: "На связи",
  paused: "На паузе",
  error: "Ошибка",
  offline: "Не в сети",
};

// Точечный статус конкретного принтера менялся молча — единственный `aria-live` страницы был
// агрегированной сводкой паркового списка. `role="status"` здесь — тот же приём, что уже принят
// на `/printer/:id` (printerlivescreen.tsx `printerLiveAnnouncement`, docs/design/printer.surface-a11y.md
// §1/§3): видимый текст пилюли одновременно и есть объявление, второй скрытый дубль не заводим.
function ConnectionRow({ live }: { live: LiveState | null }) {
  if (!live || !live.live) {
    return (
      <span role="status" aria-live="polite" aria-atomic="true">
        <StatusPill tone="dim">
          {live && live.phase === "offline" ? "Не в сети" : "Локально"}
        </StatusPill>
      </span>
    );
  }
  const { tone, pulse } = toneForPhase(live.phase);
  return (
    <span role="status" aria-live="polite" aria-atomic="true" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <StatusPill tone={tone} pulse={pulse}>
        {PHASE_LABEL[live.phase]}
      </StatusPill>
      {live.phase === "printing" && live.progress != null ? (
        <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{Math.round(live.progress)}%</span>
      ) : null}
    </span>
  );
}

function PilotRow({ info }: { info: PilotInfo }) {
  if (!info.visible) return null;

  return (
    <>
      <span className="parkPilotRow" title={info.hint} role="group" aria-label={info.ariaLabel}>
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span className="parkPilotSpark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M13 2 5 14h6l-1 8 9-13h-7l1-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <StatusPill tone={info.tone}>{info.label}</StatusPill>
        </span>
      </span>
      {info.secondLine ? (
        <span aria-hidden="true" style={{ color: "var(--text-dim)", fontSize: 12 }}>
          {info.secondLine}
        </span>
      ) : null}
    </>
  );
}

function BadgeFor({ level }: { level: SupportPresentation }) {
  if (level === "custom") return <FlagshipBadge>Полный портал</FlagshipBadge>;
  if (level === "custom-soon") return <StatusPill tone="dim">Custom: скоро</StatusPill>;
  if (level === "unknown") return <StatusPill tone="dim">Поддержка уточняется</StatusPill>;
  return (
    <StatusPill tone={SUPPORT_LEVEL_TONE[level]} level={SUPPORT_LEVEL_LEVEL[level]}>
      {SUPPORT_LEVEL_LABEL[level]}
    </StatusPill>
  );
}

interface PrinterRowProps {
  printer: UserPrinter;
  live: LiveState | null;
  canon: PrinterCanonMatch | null;
  onOpenEdit: (printer: UserPrinter) => void;
}

function PrinterRow({ printer, live, canon, onOpenEdit }: PrinterRowProps) {
  const level = badgeLevelFor(canon);
  const pilot = pilotInfoFor(canon?.pilotStatus, `${printer.brand} ${printer.model}`);
  const canManage = hasManagementCapability(live);
  const isManagedLocalLive = live?.connectionMode === "managed-local";
  // managed-local — read-only контракт (livesource.ts hasCommandCapability: «возможность
  // неизвестна = запрещено»), commandCapabilities для него всегда false. Тап всё равно должен
  // вести на /printer/:id — там уже рендерится read-only ManagedLocalSurface для этого режима,
  // а не общая модалка редактирования (docs/design/printer.surface-states.md §4/§5).
  const opensLiveControl = (level === "managed" || level === "custom") && (canManage || isManagedLocalLive);

  const sub = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <BadgeFor level={level} />
        {level === "managed" && !isManagedLocalLive ? <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{managedAreaFor(live)}</span> : null}
      </span>
      {level === "managed" && isManagedLocalLive ? (
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <StatusPill tone="dim">Источник: локальный запрос</StatusPill>
          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>В этой сети</span>
        </span>
      ) : null}
      {level === "managed" && !canManage && !isManagedLocalLive ? <span style={{ color: "var(--text-dim)", fontSize: 12 }}>Управление пока недоступно</span> : null}
      {/* Строка соединения (park.md §1.1/§2.2) — только managed/custom, и только пока её не
          замещает виджет пилота (§3.1 «замещает, не дублирует»). */}
      {pilot.visible ? (
        <PilotRow info={pilot} />
      ) : level === "managed" || level === "custom" ? (
        <ConnectionRow live={live} />
      ) : null}
    </div>
  );

  return (
    <ActionCard
      className="parkPrinterRow"
      title={printerLabel(printer)}
      sub={sub}
      icon={<PrinterIcon size={18} />}
      onClick={() => (opensLiveControl ? navigate(printerDevicePath(printer.id)) : onOpenEdit(printer))}
    />
  );
}

export function ParkScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const { loading, printers, updatePrinter } = useActivation();
  const overlay = useOverlay();
  const [liveById, setLiveById] = useState<Record<string, LiveState>>({});
  const [canonByKey, setCanonByKey] = useState<Record<string, PrinterCanonMatch | null>>({});

  // Список отдаёт ту же живую сводку, что printerlivescreen.tsx (§2.1) — один поллинг-источник на
  // устройство, не второй механизм для страницы списка (§2.2 «список подписывается на несколько
  // устройств сразу тем же источником»).
  useEffect(() => {
    const source = httpPrinterLiveSource();
    const unsubs = printers.map((printer) => source.subscribe(printer.id, (state) => {
      setLiveById((prev) => ({ ...prev, [printer.id]: state }));
    }));
    return () => unsubs.forEach((unsub) => unsub());
  }, [printers]);

  useEffect(() => {
    let cancelled = false;
    printers.forEach((printer) => {
      const key = `${printer.brand}::${printer.model}`;
      if (key in canonByKey) return;
      findPrinterCanon(printer.brand, printer.model).then((info) => {
        if (!cancelled) setCanonByKey((prev) => ({ ...prev, [key]: info }));
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printers]);

  function openEditPrinter(printer: UserPrinter) {
    const handle = overlay.modal({
      title: "Изменить принтер",
      content: (
        <PrinterEditForm
          printer={printer}
          onSave={async (patch: PrinterPatch) => {
            const ok = await updatePrinter(printer.id, patch);
            if (ok) handle.close();
            else overlay.toast({ severity: "warn", title: "Не удалось сохранить" });
          }}
          onMakePrimary={
            printer.is_primary
              ? undefined
              : async () => {
                  const ok = await updatePrinter(printer.id, { is_primary: true });
                  if (ok) handle.close();
                  else overlay.toast({ severity: "warn", title: "Не удалось сделать основным" });
                }
          }
        />
      ),
    });
  }

  // Сортировка (§1.2): активная печать — первыми, дальше по времени добавления (порядок с
  // сервера уже is_primary desc, created_at — печатающие просто поднимаются над ним).
  const sorted = useMemo(() => {
    return [...printers].sort((a, b) => {
      const aPrinting = liveById[a.id]?.phase === "printing" ? 1 : 0;
      const bPrinting = liveById[b.id]?.phase === "printing" ? 1 : 0;
      return bPrinting - aPrinting;
    });
  }, [printers, liveById]);

  const liveSummary = useMemo(() => {
    const printing = sorted.filter((printer) => liveById[printer.id]?.phase === "printing").length;
    const online = sorted.filter((printer) => {
      const live = liveById[printer.id];
      return live?.live && live.phase !== "offline";
    }).length;
    const countLabel = sorted.length === 1 ? "принтер" : sorted.length < 5 ? "принтера" : "принтеров";
    return `${sorted.length} ${countLabel} · ${printing} печатает · ${online} на связи`;
  }, [sorted, liveById]);

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} mode={headerModeFor("park")} />
      </div>
      <main className="homeContent">
        <div className="parkListPage">
          <div className="parkListHeader">
            <div>
              <Heading size="md">Мой парк</Heading>
              {!loading && sorted.length > 0 ? <p className="parkLiveSummary" aria-live="polite">{liveSummary}</p> : null}
            </div>
            {loading || sorted.length > 0 ? (
              <Button variant="primary" icon={null} onClick={() => navigate(parkAddPath())}>
                + Добавить принтер
              </Button>
            ) : null}
          </div>

          {loading ? (
            <div className="ideaList">
              <div className="ideaRowSkeleton" />
            </div>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<PrinterIcon size={20} />}
              title="Ваш парк пока пуст"
              sub="Добавьте первый принтер — станет виден статус и придут рекомендации."
              action={
                <Button variant="primary" icon={null} onClick={() => navigate(parkAddPath())}>
                  Добавить принтер
                </Button>
              }
            />
          ) : (
            <div className="parkList">
              {sorted.map((printer) => (
                <PrinterRow
                  key={printer.id}
                  printer={printer}
                  live={liveById[printer.id] ?? null}
                  canon={canonByKey[`${printer.brand}::${printer.model}`] ?? null}
                  onOpenEdit={openEditPrinter}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
