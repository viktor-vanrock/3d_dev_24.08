import { useEffect, useState } from "react";
import type { components } from "src/api/generated/openapi";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
import { AuroraBackground } from "@shared/ui";
import { createThread, listThreads, sendMessage, stashPendingRun } from "./assistantapi.ts";
import { formatThreadUpdatedAt } from "./types.ts";
import { AssistantWorkshopScreen } from "./workshop.tsx";
import "./assistant.css";

export function AssistantChatsScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const [threads, setThreads] = useState<components["schemas"]["AssistantThreadDto"][] | null>(null);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<"giga" | "research" | "make">("giga");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listThreads().then((items) => {
      if (!cancelled) setThreads(items ?? []);
    });
    return () => { cancelled = true; };
  }, []);

async function submit() {
    const value = query.trim();
    if (!value || sending) return;
    setSending(true);
    const thread = await createThread(value.slice(0, 72));
    if (!thread) { setSending(false); return; }
    const result = await sendMessage(thread.id, value);
    if ("error" in result) { setSending(false); return; }
    if (!result.run) { setSending(false); return; }
    stashPendingRun(thread.id, result.run.id);
    setThreads((current) => current ? [thread, ...current.filter((item) => item.id !== thread.id)] : [thread]);
    setQuery("");
    setSending(false);
    setActiveThreadId(thread.id);
  }

  return (
    <div className="home assistantChatsPage">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} />
      </div>
      <main className="homeWorkspaceBody assistantGigaBody">
        <aside className="assistantGigaRail" aria-label="история чатов">
          <div className="assistantGigaRailActions">
            <button type="button" className="assistantCommandNew pressable" onClick={() => { setQuery(""); setActiveThreadId(null); }}><span>＋</span> Новый чат</button>
            <button type="button" className="assistantGigaSearch pressable" aria-label="Поиск по чатам" title="Поиск по чатам">⌕</button>
          </div>
          <span className="assistantKicker">Недавние</span>
          <div className="assistantGigaThreads">
            {threads === null ? <span className="assistantGigaLoading">Загружаем историю…</span> : threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="assistantCommandThread pressable"
                aria-current={activeThreadId === thread.id ? "page" : undefined}
                onClick={() => setActiveThreadId(thread.id)}
              >
                <span><strong>{thread.title ?? "Без названия"}</strong><small>{formatThreadUpdatedAt(thread.updated_at)}</small></span>
              </button>
            ))}
          </div>
        </aside>

        {activeThreadId ? (
          <section className="assistantGigaConversation">
            <AssistantWorkshopScreen user={user} threadId={activeThreadId} embedded />
          </section>
        ) : <section className="assistantGigaWelcome" data-active={query.trim() ? "true" : "false"}>
          <h1 className="srOnly">ГигаЧат</h1>
          <form className="assistantCommandComposer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <textarea
              aria-label="Сообщение ГигаЧату"
              placeholder="Найдите, спросите или поручите сделать"
              rows={3}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
              }}
            />
            <div className="assistantCommandComposerBar">
              <div className="assistantGigaComposerTools">
                <button type="button" className="assistantGigaAttach pressable" aria-label="Прикрепить файл" title="Прикрепить файл">＋</button>
                <div className="assistantCommandModes" role="tablist" aria-label="Режим">
                  <button type="button" role="tab" aria-selected={mode === "giga"} onClick={() => setMode("giga")}>ГигаЧат</button>
                  <button type="button" role="tab" aria-selected={mode === "research"} onClick={() => setMode("research")}>Исследование</button>
                  <button type="button" role="tab" aria-selected={mode === "make"} onClick={() => setMode("make")}>Сделать</button>
                </div>
              </div>
              <button type="submit" className="assistantCommandSend pressable" disabled={!query.trim() || sending}>{sending ? "В очередь…" : "Отправить"} <span>↑</span></button>
            </div>
          </form>
          <div className="assistantCommandSuggestions">
            {["Найти проект на вечер", "Помочь с принтером", "Сделать 3D-модель", "Проверить ферму"].map((text) => (
              <button key={text} type="button" className="pressable" onClick={() => setQuery(text)}>{text}</button>
            ))}
          </div>
        </section>}
      </main>
    </div>
  );
}