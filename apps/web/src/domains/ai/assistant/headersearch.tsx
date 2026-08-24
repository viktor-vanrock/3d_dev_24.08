import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 9): ai→access useGuestLogin (гостевой вход из поиска ассистента), развязка отложена до pages/DI. См. MIGRATION.md.
import { useGuestLogin } from "@domains/access";
// eslint-disable-next-line boundaries/entry-point -- статичный ассет, не index.ts; тот же паттерн, что CSS side-effect импорты. См. MIGRATION.md.
import gigaChatMark from "@shared/assets/gigachat-mark.svg";
import {
  assistantPageContext,
  dispatchAssistantContextSearch,
  openAssistantExperience,
  type AssistantPageKind,
} from "./events.ts";
import "./headersearch.css";

const QUICK_QUERIES: Record<AssistantPageKind, string[]> = {
  home: ["Проект на вечер", "Без поддержек", "Что напечатать из PLA"],
  feed: ["Проекты сообщества", "Обзоры принтеров", "Новости брендов"],
  printers: ["Для начинающих", "С AMS", "До 100 000 ₽"],
  projects: ["Без AMS", "На один вечер", "Для моего принтера"],
  site: ["Найти проект", "Помочь с принтером", "Спросить о печати"],
};

export function AssistantHeaderSearch({
  user,
  onTypingChange,
  contextKey,
}: {
  user: SessionUser | null;
  onTypingChange?: (typing: boolean) => void;
  // Постоянная шапка больше не перемонтируется на route. Ключ сообщает поиску, что нужно
  // перечитать pathname/placeholder и оставить тот же DOM-узел в новом контексте.
  contextKey?: string;
}) {
  const promptGuestLogin = useGuestLogin();
  const context = useMemo(() => assistantPageContext(), [contextKey]);
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const value = query.trim();
  const suggestionsOpen = focused && value.length > 0;

  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
    setFocused(false);
    onTypingChange?.(false);
  }, [context.kind, context.pathname, onTypingChange]);

  useEffect(() => {
    if (!query.trim()) {
      onTypingChange?.(false);
      return;
    }
    onTypingChange?.(true);
    const timer = window.setTimeout(() => onTypingChange?.(false), 720);
    return () => window.clearTimeout(timer);
  }, [query, onTypingChange]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [suggestionsOpen]);

  function openGiga() {
    if (!user) {
      promptGuestLogin();
      return;
    }
    onTypingChange?.(false);
    openAssistantExperience(query.trim(), context);
    setFocused(false);
  }

  function search(nextQuery: string) {
    setQuery(nextQuery);
    dispatchAssistantContextSearch(nextQuery, context);
    onTypingChange?.(false);
    setFocused(false);
  }

  return (
    <form
      ref={formRef}
      className="assistantHeaderSearch"
      role="search"
      data-context={context.kind}
      data-has-query={query.trim() ? "true" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!value) {
          openGiga();
          return;
        }
        search(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setFocused(false);
          inputRef.current?.blur();
        }
      }}
    >
      <button
        type="button"
        className="assistantHeaderFocus pressable"
        aria-label="Перейти к поиску"
        onClick={() => {
          if (window.matchMedia("(max-width: 760px)").matches) {
            openGiga();
            return;
          }
          setFocused(true);
          inputRef.current?.focus();
        }}
      >
        <SearchIcon />
      </button>
      <input
        ref={inputRef}
        aria-label={context.placeholder}
        value={query}
        placeholder={context.placeholder}
        autoComplete="off"
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setFocused(true);
        }}
      />
      {suggestionsOpen ? (
        <section className="assistantHeaderDropdown" aria-label="Варианты поиска">
          <button type="button" className="assistantHeaderExact pressable" onClick={() => search(value)}>
            <span className="assistantHeaderResultIcon"><SearchIcon /></span>
            <span>
              <strong>Найти «{value}»</strong>
              <small>Показать подходящее на этой странице</small>
            </span>
            <span aria-hidden="true">↵</span>
          </button>

          <div className="assistantHeaderQuick" aria-label="Быстрые запросы">
            {QUICK_QUERIES[context.kind].map((suggestion) => (
              <button key={suggestion} type="button" className="pressable" onClick={() => search(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>

          <button type="button" className="assistantHeaderAsk pressable" onClick={openGiga}>
            <span className="assistantHeaderAskMark" aria-hidden="true"><img src={gigaChatMark} alt="" /></span>
            <span>
              <strong>Продолжить в ГигаЧате</strong>
              <small>Диалог, сравнение и работа с инструментами</small>
            </span>
            <span className="assistantHeaderAskArrow" aria-hidden="true">→</span>
          </button>
        </section>
      ) : null}
    </form>
  );
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
