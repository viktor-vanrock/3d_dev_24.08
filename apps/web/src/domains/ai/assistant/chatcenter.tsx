import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { assistantChatsPath, navigateWithTransition } from "../../../router.ts";
import { createThread, sendMessage, stashPendingRun } from "./assistantapi.ts";
import { ASSISTANT_OPEN_EVENT, assistantPageContext, type AssistantOpenDetail, type AssistantPageContext } from "./events.ts";
import { AssistantWorkshopScreen } from "./workshop.tsx";
import "./assistant.css";

type AssistantMode = "giga" | "research" | "make";
type AssistantPerformance = "fast" | "balanced" | "deep";

export function AssistantChatCenter({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<AssistantMode>("giga");
  const [performance, setPerformance] = useState<AssistantPerformance>("balanced");
  const [context, setContext] = useState<AssistantPageContext>(() => assistantPageContext());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<AssistantOpenDetail>).detail;
      setContext(detail?.context ?? assistantPageContext());
      setQuery(detail?.query ?? "");
      setActiveThreadId(null);
      setOpen(true);
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function submit() {
    const value = query.trim();
    if (!value || sending) return;
    setSending(true);
    setError("");
    const thread = await createThread(value.slice(0, 72));
    if (!thread) {
      setSending(false);
      setError("Не удалось начать чат. Попробуйте ещё раз.");
      return;
    }
    const result = await sendMessage(thread.id, value);
    if ("error" in result) {
      setSending(false);
      setError("Запрос не отправился. Чат сохранён — можно продолжить из истории.");
      return;
    }
    if (!result.run) {
      setSending(false);
      setError("Запрос не отправился. Попробуйте ещё раз.");
      return;
    }
    stashPendingRun(thread.id, result.run.id);
    setQuery("");
    setSending(false);
    setActiveThreadId(thread.id);
  }

  if (!open) return null;

  return (
    <div className="assistantCommandOverlay" role="dialog" aria-modal="true" aria-label="ГигаЧат — поиск и помощник">
      <button type="button" className="assistantCommandScrim" aria-label="Закрыть ГигаЧат" onClick={() => setOpen(false)} />
      <section ref={panelRef} className={`assistantCommandCenter${activeThreadId ? " isConversation" : ""}`}>
        <main className="assistantCommandMain">
          {activeThreadId ? (
            <>
              <button type="button" className="assistantCommandClose pressable" aria-label="Закрыть" onClick={() => setOpen(false)}><CloseIcon /></button>
              <AssistantWorkshopScreen user={user} threadId={activeThreadId} embedded />
            </>
          ) : (
            <div className="assistantCommandStart" data-performance={performance}>
              <div className="assistantCommandTopbar">
                <button type="button" className="assistantCommandAll pressable" onClick={() => { setOpen(false); navigateWithTransition(assistantChatsPath(), "fwd"); }}>
                  Все чаты <span>↗</span>
                </button>
                <button type="button" className="assistantCommandClose pressable" aria-label="Закрыть" onClick={() => setOpen(false)}><CloseIcon /></button>
              </div>
              <form className="assistantCommandComposer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                <textarea
                  aria-label="Сообщение ГигаЧату"
                  placeholder={context.placeholder}
                  rows={3}
                  value={query}
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                />
                <div className="assistantCommandComposerBar">
                  <div className="assistantGigaComposerTools">
                    <button type="button" className="assistantGigaAttach pressable" aria-label="Прикрепить файл" title="Прикрепить файл">＋</button>
                    <div className="assistantCommandModes" role="tablist" aria-label="Режим ГигаЧата">
                      {([
                        ["giga", "ГигаЧат"],
                        ["research", "Исследование"],
                        ["make", "Сделать"],
                      ] as const).map(([value, label]) => (
                        <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <button type="submit" className="assistantCommandSend pressable" disabled={!query.trim() || sending}>
                    {sending ? "В очередь…" : "Отправить"} <span>↑</span>
                  </button>
                </div>
              </form>
              {error ? <div className="assistantCommandError" role="status">{error}</div> : null}
              <div className="assistantCommandSuggestions" aria-label="Подсказки">
                {["Что напечатать сегодня", "Подобрать принтер", "Разобрать ошибку печати", "Собрать проект из Git"].map((text) => (
                  <button key={text} type="button" className="pressable" onClick={() => setQuery(text)}>{text}</button>
                ))}
              </div>
              <div className="assistantCommandPerformance">
                <span>Глубина ответа</span>
                <div role="radiogroup" aria-label="Производительность ГигаЧата">
                  {([
                    ["fast", "Быстро"],
                    ["balanced", "Баланс"],
                    ["deep", "Глубоко"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={performance === value}
                      onClick={() => setPerformance(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
