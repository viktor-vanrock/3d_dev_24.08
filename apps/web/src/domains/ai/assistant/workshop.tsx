import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  isAssistantAnswer,
  isAssistantClarification,
  isAssistantError,
  isAssistantGenerationOffer,
  type AssistantMessage,
  type AssistantRun,
  type AssistantThread
} from "@portal/contracts/http/assistant";
import type { SessionUser } from "@shared/types";
import {
  confirmGeneration,
  getRun,
  getThread,
  listMessages,
  sendMessage,
  takePendingRun,
  type ConfirmGenerationResult,
} from "./assistantapi.ts";
import { getGeneration, type Generation, type GenerationPhase } from "../generate/generations.ts";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): ai→commerce ModelViewer (предпросмотр 3D-генерации в мастерской переиспользует вьювер моделей каталога), развязка отложена до pages/DI. См. MIGRATION.md.
import { ModelViewer } from "@domains/commerce";
import { assistantChatsPath, navigate, navigateWithTransition } from "../../../router.ts";
import { AuroraBackground, Button } from "@shared/ui";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- CSS side-effect, не index.ts; легатное ребро ai→commerce (Этап 9), см. выше.
import "../../commerce/model.css";
import "./assistant.css";

const POLL_MS = 2500;
const RETRY_POLL_MS = 4500;
const RUN_POLL_MS = 1500;
type PollState = "idle" | "syncing" | "connected" | "retrying";

export function AssistantWorkshopScreen({
  user: _user,
  threadId,
  embedded = false,
}: {
  user: SessionUser;
  threadId: string;
  embedded?: boolean;
}) {
  const [thread, setThread] = useState<AssistantThread | null | undefined>(undefined);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [runsByMessageId, setRunsByMessageId] = useState<Record<string, AssistantRun>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [pollState, setPollState] = useState<PollState>("idle");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  // Загрузка треда + истории сообщений. pending run (assistantapi.ts::stashPendingRun) —
  // подсказка от экрана, который только что создал тред и отправил первый вопрос (home.search.tsx/
  // guestresume.tsx) — без неё после навигации мы бы знали только сам факт наличия
  // user-сообщения, но не run, который на него отвечает (assistant_messages не хранит
  // ответных строк, ответ живёт только в assistant_runs.result, см. docs/contracts/
  // assistant.run.v1.md).
  useEffect(() => {
    let cancelled = false;
    setThread(undefined);
    setMessages([]);
    setRunsByMessageId({});
    setActiveRunId(null);
    setGeneration(null);
    (async () => {
      const loaded = await getThread(threadId);
      if (cancelled) return;
      setThread(loaded);
      if (!loaded) return;
      const items = await listMessages(threadId);
      if (cancelled) return;
      setMessages(items ?? []);
      const pendingRunId = takePendingRun(threadId);
      if (pendingRunId) setActiveRunId(pendingRunId);
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, activeRunId]);

  // Поллинг активного run'а (assistant.v1 SSE ещё не подключён на фронте — обычный интервал,
  // тот же приём, что уже был у поллинга generation ниже).
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    let timer: number | null = null;
    const runId = activeRunId;
    const read = async () => {
      const run = await getRun(threadId, runId);
      if (cancelled) return;
      if (!run) {
        timer = window.setTimeout(() => void read(), RETRY_POLL_MS);
        return;
      }
      if (run.status === "queued" || run.status === "running") {
        timer = window.setTimeout(() => void read(), RUN_POLL_MS);
        return;
      }
      setRunsByMessageId((current) => ({ ...current, [run.triggering_message_id]: run }));
      setActiveRunId(null);
      if (run.confirmed_generation_id) {
        const existing = await getGeneration(run.confirmed_generation_id);
        if (!cancelled && existing) setGeneration(existing);
      }
    };
    void read();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeRunId, threadId]);

  // Поллинг самой генерации после подтверждения offer'а — независимая ось от run'а (тот
  // подтверждён и завершён), тот же паттерн polling, что был у fixture-версии.
  useEffect(() => {
    if (!generation || generation.status === "done" || generation.status === "error") {
      if (!generation) setPollState("idle");
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    setPollState("syncing");
    const read = async () => {
      const result = await getGeneration(generation.id);
      if (cancelled) return;
      if (!result) {
        setPollState("retrying");
        timer = window.setTimeout(() => void read(), RETRY_POLL_MS);
        return;
      }
      setPollState("connected");
      setGeneration(result);
      if (result.status === "queued" || result.status === "running") {
        timer = window.setTimeout(() => void read(), POLL_MS);
      }
    };
    void read();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // generation.id — единственное, что должно перезапускать polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation?.id]);

  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user") ?? null,
    [messages],
  );
  const currentRun = lastUserMessage ? (runsByMessageId[lastUserMessage.id] ?? null) : null;
  const isThinking = activeRunId !== null;

  if (thread === undefined) {
    return (
      <main className="assistantWorkshopMissing" aria-busy="true">
        <WorkshopCubeGlyph size={48} />
        <h1>Загружаем чат…</h1>
      </main>
    );
  }

  if (!thread) {
    return (
      <main className="assistantWorkshopMissing">
        <WorkshopCubeGlyph size={48} />
        <h1>Чат не найден</h1>
        <p>Он мог быть удалён или принадлежит другому аккаунту.</p>
        <Button variant="primary" icon={null} onClick={() => navigate("/")}>На главную</Button>
      </main>
    );
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const value = draft.trim();
    if (!value || !thread || isThinking) return;
    setDraft("");
    const result = await sendMessage(thread.id, value);
    if ("error" in result) {
      setDraft(value);
      return;
    }
    setMessages((current) => [...current, result.message]);
    if (result.run) setActiveRunId(result.run.id);
  }

  async function startGeneration() {
    if (!thread || submitting || !currentRun) return;
    setSubmitting(true);
    const result: ConfirmGenerationResult = await confirmGeneration(thread.id, currentRun.id);
    setSubmitting(false);
    if ("error" in result) return;
    setGeneration(result.generation);
    if (lastUserMessage) {
      setRunsByMessageId((current) => ({
        ...current,
        [lastUserMessage.id]: { ...currentRun, confirmed_generation_id: result.generation.id },
      }));
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || composingRef.current) return;
    event.preventDefault();
    void submitMessage();
  }

  const offerVisible =
    currentRun !== null &&
    isAssistantGenerationOffer(currentRun.result) &&
    !currentRun.confirmed_generation_id &&
    !generation;
  const title = thread.title ?? "Новый чат";
  const stageLabel = workshopStageLabel({ isThinking, currentRun, generation, pollState });

  const conversation = (
    <section className="assistantUnifiedConversation" data-embedded={embedded || undefined} aria-label="Чат с ГигаЧатом">
      <header className="assistantUnifiedHead">
        <div>
          <strong>{title}</strong>
          <span><i data-active={isThinking || (generation && generation.status !== "done") || undefined} />{stageLabel}</span>
        </div>
      </header>

      <div ref={logRef} className="assistantUnifiedLog" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 ? (
          <p className="assistantEmptyLog">Напишите, что нужно — вопрос про принтер, проект или новая модель.</p>
        ) : null}
        {messages.map((message) => {
          const run = runsByMessageId[message.id];
          const streaming = isThinking && message.id === lastUserMessage?.id;
          return <MessageThread key={message.id} message={message} run={run} streaming={streaming} />;
        })}
        {offerVisible && currentRun && isAssistantGenerationOffer(currentRun.result) ? (
          <div className="assistantOfferAction">
            <div>
              <strong>Можно собрать 3D-модель</strong>
              <span>{currentRun.result.note ?? "Сначала проверьте идею — генерация запускается отдельно."}</span>
            </div>
            <Button variant="primary" icon={null} onClick={() => void startGeneration()} disabled={submitting}>
              {submitting ? "Запускаем…" : "Начать генерацию"}
            </Button>
          </div>
        ) : null}
        {generation?.status === "done" && (generation.artifact_url || generation.preview_url) ? (
          <section className="assistantInlineArtifact" aria-label="Готовая 3D-модель">
            <div className="assistantInlineViewer">
              <ModelViewer
                modelId={generation.id}
                title={title}
                previewUrl={
                  generation.branch === "openscad"
                    ? generation.artifact_url
                    : generation.branch === "trellis" || generation.branch === "rudalle"
                      ? (generation.preview_url ?? generation.artifact_url)
                      : generation.preview_url
                }
                thumbUrl={null}
                format={generation.branch === "openscad" ? "stl" : "gltf"}
              />
            </div>
            <div className="assistantInlineArtifactMeta">
              <span className="assistantKicker">Готовый результат</span>
              <strong>{title}</strong>
              {generation.artifact_url ? <a href={generation.artifact_url} download>Скачать модель</a> : null}
            </div>
          </section>
        ) : generation && generation.status !== "done" ? (
          <WaitingExperience generation={generation} pollState={pollState} />
        ) : null}
      </div>

      <form className="assistantUnifiedComposer" onSubmit={submitMessage}>
        <button type="button" className="assistantGigaAttach pressable" aria-label="Прикрепить файл" title="Прикрепить файл">＋</button>
        <textarea
          aria-label="Сообщение помощнику"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          placeholder={messages.length === 0 ? "Спросите ГигаЧат" : "Продолжить разговор"}
          rows={2}
          disabled={isThinking}
        />
        <button type="submit" className="assistantComposerSend pressable" aria-label="Отправить сообщение" disabled={!draft.trim() || isThinking}>↑</button>
      </form>
      <small className="assistantUnifiedDisclaimer">ГигаЧат может ошибаться — важные параметры печати лучше проверить.</small>
    </section>
  );

  if (embedded) return conversation;

  return (
    <div className="assistantConversationPage">
      <AuroraBackground />
      <header className="assistantConversationTopbar">
        <button type="button" className="assistantBackButton pressable" onClick={() => navigateWithTransition(assistantChatsPath(), "back")}>← Чаты</button>
        <button type="button" className="assistantTopbarButton pressable" onClick={() => navigate("/")}>Закрыть</button>
      </header>
      <main className="assistantConversationPageMain">{conversation}</main>
    </div>
  );
}

function workshopStageLabel({
  isThinking,
  currentRun,
  generation,
  pollState,
}: {
  isThinking: boolean;
  currentRun: AssistantRun | null;
  generation: Generation | null;
  pollState: PollState;
}): string {
  if (generation?.status === "done") return "Результат готов";
  if (generation?.status === "error") return "Нужен повтор";
  if (generation) return pollState === "retrying" ? "Восстанавливаем связь" : generation.status === "queued" ? "В очереди" : phaseLabel(generation.phase);
  if (isThinking) return "Помощник думает…";
  if (currentRun && isAssistantGenerationOffer(currentRun.result)) return "Готово к запуску";
  return "Чат";
}

function MessageThread({
  message,
  run,
  streaming,
}: {
  message: AssistantMessage;
  run: AssistantRun | undefined;
  streaming: boolean;
}) {
  return (
    <>
      <MessageBubble role="user" body={visibleMessageContent(message.content)} />
      {run ? <RunReply run={run} /> : streaming ? <ThinkingBubble /> : null}
    </>
  );
}

function visibleMessageContent(content: string): string {
  return content.replace(/^\[[^\n]+\]\n/, "");
}

function RunReply({ run }: { run: AssistantRun }) {
  const result = run.result;
  if (isAssistantClarification(result)) return <MessageBubble role="assistant" body={result.question} />;
  if (isAssistantAnswer(result)) {
    return (
      <MessageBubble role="assistant" body={result.text}>
        {result.citations.length > 0 ? (
          <ul className="assistantCitations">
            {result.citations.map((citation) => (
              <li key={citation.model_id}>{citation.title}</li>
            ))}
          </ul>
        ) : null}
      </MessageBubble>
    );
  }
  if (isAssistantGenerationOffer(result)) {
    return <MessageBubble role="assistant" body={result.note ?? `Предлагаю собрать: «${result.prompt_summary}».`} />;
  }
  if (isAssistantError(result)) {
    return <MessageBubble role="assistant" body={runErrorCopy(run.error_code)} />;
  }
  return <MessageBubble role="assistant" body="Не удалось разобрать ответ помощника." />;
}

function runErrorCopy(errorCode: string | null): string {
  if (errorCode === "provider_timeout") return "Помощник не успел ответить вовремя. Попробуйте написать ещё раз.";
  if (errorCode === "invalid_output") return "Получился нечитаемый ответ. Переформулируйте вопрос, пожалуйста.";
  return "Не удалось получить ответ. Можно попробовать ещё раз.";
}

function MessageBubble({
  role,
  body,
  children,
}: {
  role: "user" | "assistant";
  body: string;
  children?: ReactNode;
}) {
  return (
    <article className="assistantMessage" data-role={role}>
      <span className="assistantMessageAuthor">{role === "user" ? "Вы" : "3mf"}</span>
      <p>{body}</p>
      {children}
    </article>
  );
}

function ThinkingBubble() {
  return (
    <article className="assistantMessage" data-role="assistant" data-streaming="true">
      <span className="assistantMessageAuthor">3mf</span>
      <p className="assistantThinking" aria-live="polite">
        <span className="assistantStreamCursor" aria-hidden="true" />
        думает…
      </p>
    </article>
  );
}

function WaitingExperience({
  generation,
  pollState,
}: {
  generation: Generation;
  pollState: PollState;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(generation.created_at).getTime()) / 1000));
  const isQueued = generation.status === "queued";
  const isDelayed = (isQueued && elapsedSeconds >= 180) || (generation.status === "running" && elapsedSeconds >= 480);
  const activeStep = waitStepIndex(generation);
  const title =
    pollState === "retrying"
      ? "Связь прервалась — задача не потеряна"
      : isDelayed
        ? "Нужно немного больше времени"
        : isQueued
          ? "Ваш запрос в очереди"
          : phaseTitle(generation.phase);
  const detail =
    pollState === "retrying"
      ? "Продолжаем проверять в фоне. Можно закрыть мастерскую и вернуться из раздела «Чаты»."
      : isDelayed
        ? "Мощности заняты более сложными моделями. Место в очереди сохранено, повторно запускать запрос не нужно."
        : isQueued
          ? queueCopy(generation)
          : "Промежуточные этапы будут появляться здесь, а пояснения ассистента — приходить в чат.";

  return (
    <div className="assistantWaitExperience" data-state={pollState === "retrying" ? "retrying" : isQueued ? "queued" : "running"}>
      <div className="assistantWaitOrb" aria-hidden="true">
        <span className="assistantWaitOrbit assistantWaitOrbit--outer" />
        <span className="assistantWaitOrbit assistantWaitOrbit--inner" />
        <span className="assistantWaitCore"><WorkshopCubeGlyph size={58} /></span>
      </div>
      <div className="assistantWaitCopy">
        <span className="assistantKicker">
          {generation.queue_position && generation.queue_position > 0
            ? `Позиция ${generation.queue_position}`
            : isQueued
              ? "Очередь генерации"
              : "3D-пайплайн"}
        </span>
        <h1>{title}</h1>
        <p>{detail}</p>
        {generation.eta_seconds || isQueued ? (
          <strong className="assistantWaitEta">
            {generation.eta_seconds
              ? `Примерно через ${formatEta(generation.eta_seconds)}`
              : isDelayed
                ? "Обновим оценку, когда освободится генератор"
                : "Обычно первая версия занимает 2–4 минуты"}
          </strong>
        ) : null}
      </div>
      <ol className="assistantWaitSteps" aria-label="Этапы генерации">
        {["Очередь", "Черновая форма", "Геометрия", "Экспорт"].map((label, index) => (
          <li key={label} data-active={index === activeStep || undefined} data-done={index < activeStep || undefined}>
            <span>{index < activeStep ? "✓" : String(index + 1).padStart(2, "0")}</span>
            {label}
          </li>
        ))}
      </ol>
      <div
        className="assistantWaitProgress"
        role="progressbar"
        aria-label="Прогресс генерации"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={typeof generation.progress === "number" ? Math.round(generation.progress) : undefined}
        data-indeterminate={typeof generation.progress !== "number" || undefined}
      >
        <span style={typeof generation.progress === "number" ? { width: `${Math.max(0, Math.min(100, generation.progress))}%` } : undefined} />
      </div>
      <span className="assistantWaitBackgroundHint">Можно уйти со страницы — задача продолжится в фоне</span>
    </div>
  );
}

function queueCopy(generation: Generation): string {
  if (generation.queue_position && generation.queue_position > 1) {
    return `Перед вами ${generation.queue_position - 1}. Как только освободится генератор, работа начнётся автоматически.`;
  }
  if (generation.queue_position === 1) {
    return "Вы следующие. Подготавливаем модель и свободный генератор.";
  }
  return "Мощности ограничены, поэтому запускаем задачи по очереди. Место уже сохранено.";
}

function formatEta(seconds: number): string {
  if (seconds < 60) return "минуту";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")}`;
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function waitStepIndex(generation: Generation): number {
  if (generation.status === "queued") return 0;
  if (generation.status === "done") return 4;
  if (generation.phase === "export" || generation.phase === "validation") return 3;
  if (generation.phase === "geometry") return 2;
  return 1;
}

function phaseTitle(phase: GenerationPhase | null | undefined): string {
  if (phase === "loading") return "Подготавливаем генератор";
  if (phase === "geometry") return "Строим геометрию";
  if (phase === "validation") return "Проверяем сетку";
  if (phase === "export") return "Собираем 3D-файл";
  return "Создаём первую форму";
}

function phaseLabel(phase: GenerationPhase | null | undefined): string {
  if (phase === "loading") return "Подготавливаем";
  if (phase === "geometry") return "Строим геометрию";
  if (phase === "validation") return "Проверяем";
  if (phase === "export") return "Экспортируем";
  return "Создаём модель";
}

function WorkshopCubeGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4l8-4.6Zm0 0V12m0 9.2V12m0 0L4 7.4m8 4.6 8-4.6" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
    </svg>
  );
}
