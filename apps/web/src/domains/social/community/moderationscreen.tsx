import { useEffect, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { AuroraBackground, Button, EmptyState, Heading, StatusPill } from "@shared/ui";
import {
  claimModerationFlag,
  decideModerationFlag,
  loadCommunityRestrictions,
  loadModerationQueue,
  MODERATION_REASONS,
  moderationReasonLabel,
  reverseModerationAction,
  type CommunityRestriction,
  type ModerationActionType,
  type ModerationApiError,
  type ModerationFlag,
  type ModerationReasonCode,
} from "./moderation.ts";
import "./moderation.css";

type QueueState = "loading" | "ready" | "forbidden" | "error";
type ActiveAction = { id: string; type: ModerationActionType } | null;

function formatResetAt(resetAt: string): string {
  const parsed = new Date(resetAt);
  if (Number.isNaN(parsed.getTime())) return resetAt;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function restrictionText(restriction: CommunityRestriction): string {
  if (restriction.remaining === 1) return `${restriction.action}: осталось 1 действие`;
  if (typeof restriction.remaining === "number") return `${restriction.action}: осталось ${restriction.remaining} действий`;
  return `${restriction.action}: действие пока ограничено`;
}

function errorState(error: unknown): Exclude<QueueState, "loading" | "ready"> {
  return (error as ModerationApiError).status === 403 ? "forbidden" : "error";
}

export function ModerationScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const [queueState, setQueueState] = useState<QueueState>("loading");
  const [flags, setFlags] = useState<ModerationFlag[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restrictions, setRestrictions] = useState<CommunityRestriction[] | null>(null);
  const [restrictionError, setRestrictionError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [reversalOpen, setReversalOpen] = useState(false);

  const selected = flags.find((flag) => flag.id === selectedId) ?? flags[0] ?? null;

  async function loadQueue() {
    setQueueState("loading");
    setMessage("");
    try {
      const next = await loadModerationQueue();
      setFlags(next);
      setSelectedId((previous) => (previous && next.some((flag) => flag.id === previous) ? previous : next[0]?.id ?? null));
      setQueueState("ready");
    } catch (error) {
      setQueueState(errorState(error));
    }
  }

  async function loadRestrictions() {
    setRestrictionError(false);
    try {
      setRestrictions(await loadCommunityRestrictions());
    } catch {
      setRestrictionError(true);
      setRestrictions(null);
    }
  }

  useEffect(() => {
    void loadQueue();
    void loadRestrictions();
  }, []);

  async function claim() {
    if (!selected || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await claimModerationFlag(selected.id);
      setFlags((previous) => previous.map((flag) => (flag.id === result.id ? { ...flag, status: result.status } : flag)));
      setMessage("Материал взят в работу.");
    } catch {
      setMessage("Не удалось взять материал в работу. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(actionType: ModerationActionType, reason: ModerationReasonCode, details: string) {
    if (!selected || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await decideModerationFlag(selected.id, { action_type: actionType, reason_code: reason, details });
      setFlags((previous) => previous.map((flag) => (flag.id === result.flag.id ? { ...flag, status: result.flag.status } : flag)));
      setActiveAction(result.action);
      setMessage("Решение применено. Оно попадёт в журнал модерации.");
    } catch {
      setMessage("Не удалось применить решение. Состояние материала не менялось в интерфейсе.");
    } finally {
      setBusy(false);
    }
  }

  async function reverse(reason: string) {
    if (!activeAction || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await reverseModerationAction(activeAction.id, reason);
      setActiveAction(null);
      setReversalOpen(false);
      setMessage("Решение отменено. История модерации сохранена.");
    } catch {
      setMessage("Не удалось отменить решение. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home moderationPage">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} />
      </div>
      <main className="homeContent moderationContent">
        <header className="moderationHeading">
          <div>
            <p className="moderationKicker">Сообщество</p>
            <Heading size="hero">Очередь модерации</Heading>
            <p>Решения применяются только после ответа сервера и сохраняются в журнале.</p>
          </div>
          <StatusPill tone="warn">Требует проверки</StatusPill>
        </header>

        <Tl0Banner restrictions={restrictions} failed={restrictionError} onRetry={loadRestrictions} />

        {message ? <div className="moderationNotice" aria-live="polite">{message}</div> : null}

        {queueState === "loading" ? <QueueSkeleton /> : null}
        {queueState === "forbidden" ? (
          <div className="moderationError" role="alert">У вас нет доступа к очереди модерации.</div>
        ) : null}
        {queueState === "error" ? (
          <div className="moderationError" role="alert">
            <span>Не удалось загрузить очередь.</span>
            <Button variant="secondary" onClick={() => void loadQueue()}>Повторить</Button>
          </div>
        ) : null}
        {queueState === "ready" && flags.length === 0 ? (
          <EmptyState icon={<span aria-hidden="true">✓</span>} title="В очереди нет материалов для проверки." sub="Новые жалобы появятся здесь после ответа сервера." />
        ) : null}
        {queueState === "ready" && selected ? (
          <div className="moderationWorkspace">
            <section className="moderationQueue" aria-label="Жалобы в очереди">
              {flags.map((flag) => (
                <button
                  type="button"
                  key={flag.id}
                  className="moderationQueueItem pressable"
                  data-selected={flag.id === selected.id || undefined}
                  onClick={() => setSelectedId(flag.id)}
                >
                  <span>{moderationReasonLabel(flag.reason_code)}</span>
                  <small>{flag.target.type === "post" ? "Пост" : "Тред"} · {flag.status === "open" ? "Новая" : "На проверке"}</small>
                </button>
              ))}
            </section>
            <FlagDetail
              flag={selected}
              busy={busy}
              action={activeAction}
              onClaim={() => void claim()}
              onDecide={(action, reason, details) => void decide(action, reason, details)}
              onReverse={() => setReversalOpen(true)}
            />
          </div>
        ) : null}
      </main>
      {reversalOpen && activeAction ? <ReversalDialog busy={busy} onCancel={() => setReversalOpen(false)} onSubmit={(reason) => void reverse(reason)} /> : null}
    </div>
  );
}

function Tl0Banner({ restrictions, failed, onRetry }: { restrictions: CommunityRestriction[] | null; failed: boolean; onRetry: () => void }) {
  if (failed) {
    return <div className="moderationError moderationTl0Error" role="alert"><span>Не удалось проверить ограничения. Попробуйте ещё раз.</span><Button variant="secondary" onClick={onRetry}>Повторить</Button></div>;
  }
  if (!restrictions || restrictions.length === 0) return null;
  return (
    <section className="moderationTl0" aria-labelledby="tl0-title">
      <div>
        <h2 id="tl0-title">Новый аккаунт: часть действий пока ограничена</h2>
        <p>Ограничения снимутся автоматически по мере активности.</p>
      </div>
      <ul>
        {restrictions.map((restriction) => (
          <li key={restriction.action}>
            <span>{restrictionText(restriction)}</span>
            {restriction.reset_at ? <small>Следующая попытка: <time dateTime={restriction.reset_at}>{formatResetAt(restriction.reset_at)}</time></small> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FlagDetail({
  flag,
  busy,
  action,
  onClaim,
  onDecide,
  onReverse,
}: {
  flag: ModerationFlag;
  busy: boolean;
  action: ActiveAction;
  onClaim: () => void;
  onDecide: (action: ModerationActionType, reason: ModerationReasonCode, details: string) => void;
  onReverse: () => void;
}) {
  const [reason, setReason] = useState<ModerationReasonCode | "">("");
  const [details, setDetails] = useState("");
  const canDecide = flag.status === "in_review" && reason !== "" && details.trim().length > 0 && !busy;

  return (
    <section className="moderationDetail" aria-label="Детали жалобы">
      <div className="moderationDetailMeta">
        <StatusPill tone={flag.status === "open" ? "warn" : "dim"}>{flag.status === "open" ? "Новая жалоба" : "На проверке"}</StatusPill>
        <span>{flag.target.type === "post" ? "Пост" : "Тред"}</span>
      </div>
      <h2>{moderationReasonLabel(flag.reason_code)}</h2>
      <p>Открытие карточки не меняет статус. Жалобщик и внутренние данные не показаны.</p>
      {flag.status === "open" ? <Button loading={busy} onClick={onClaim}>Взять в работу</Button> : null}
      {flag.status === "in_review" ? (
        <>
          <label className="moderationLabel" htmlFor="moderation-reason">Причина решения</label>
          <select id="moderation-reason" className="uiInput" value={reason} onChange={(event) => setReason(event.target.value as ModerationReasonCode | "")} disabled={busy}>
            <option value="">Выберите причину</option>
            {MODERATION_REASONS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
          <label className="moderationLabel" htmlFor="moderation-details">Пояснение для журнала модерации</label>
          <textarea id="moderation-details" className="uiInput moderationTextarea" value={details} onChange={(event) => setDetails(event.target.value)} disabled={busy} />
          <p className="moderationHint">Действие попадёт в журнал модерации.</p>
          <div className="moderationActionGrid">
            <Button variant="danger" disabled={!canDecide} onClick={() => onDecide("hide", reason as ModerationReasonCode, details)}>Скрыть</Button>
            <Button variant="secondary" disabled={!canDecide} onClick={() => onDecide("restore", reason as ModerationReasonCode, details)}>Вернуть видимость</Button>
            <Button variant="secondary" disabled={!canDecide || flag.target.type !== "thread"} onClick={() => onDecide("lock_thread", reason as ModerationReasonCode, details)}>Закрыть тред</Button>
            <Button variant="secondary" disabled={!canDecide} onClick={() => onDecide("reject_flag", reason as ModerationReasonCode, details)}>Отклонить флаг</Button>
          </div>
        </>
      ) : null}
      {flag.appeal ? <AppealStatus appeal={flag.appeal} /> : null}
      {action ? <Button variant="secondary" onClick={onReverse}>Отменить</Button> : null}
    </section>
  );
}

function AppealStatus({ appeal }: { appeal: NonNullable<ModerationFlag["appeal"]> }) {
  const text = appeal.status === "pending"
    ? "Апелляция уже рассматривается."
    : appeal.status === "restored"
      ? "Решение пересмотрено: материал снова виден."
      : `Решение оставлено в силе: ${moderationReasonLabel(appeal.reason_code)}.`;
  return <div className="moderationAppeal" aria-live="polite">{text}</div>;
}

function ReversalDialog({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="moderationDialogBackdrop">
      <section className="moderationDialog" role="dialog" aria-modal="true" aria-labelledby="reversal-title">
        <h2 id="reversal-title">Отменить действие</h2>
        <p>Отмена создаст отдельную запись и не удалит первоначальное решение.</p>
        <label className="moderationLabel" htmlFor="reversal-reason">Причина отмены</label>
        <textarea id="reversal-reason" className="uiInput moderationTextarea" value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
        <div className="moderationDialogActions">
          <Button variant="secondary" onClick={onCancel}>Отмена</Button>
          <Button disabled={reason.trim().length === 0 || busy} loading={busy} onClick={() => onSubmit(reason.trim())}>Подтвердить отмену</Button>
        </div>
      </section>
    </div>
  );
}

function QueueSkeleton() {
  return <div className="moderationSkeleton" aria-label="Загрузка очереди"><span /><span /><span /></div>;
}
