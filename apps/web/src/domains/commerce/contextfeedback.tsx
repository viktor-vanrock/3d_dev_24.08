import { useId } from "react";
import { Chip, PopoverItem } from "@shared/ui";
import { issueNewPath, navigate, type IssueRef } from "../../router.ts";
import "./contextfeedback.css";

// Связующий слой «Идей» (MF-694, docs/design/feedback.entrypoints.md). ContextFeedbackDoor/
// ContextChip/TypeSelect/ProblemTag — компоненты §1/§3/§4 спеки: дверь встроена в 4 точки входа
// (market/profile/model), TypeSelect подключён к форме /issue/new (pages/ideasubmit.tsx),
// ProblemTag — на странице идеи (issue/ideascreen.tsx).
//
// Гостевой промпт входа (§1.1 «дверь видна гостю, по тапу — Войдите…») здесь не реализован:
// весь apps/web сегодня закрыт AuthGate (app.tsx) — гость не видит market/profile/model
// вообще, только экран логина, так что в этих 4 точках входа guest-ветка недостижима. Если
// эпик откроет публичный просмотр без логина, гейт понадобится тогда — здесь его нет,
// чтобы не городить мёртвый код под сценарий, которого сегодня не бывает.

export type FeedbackDoorPreset = "problem" | "suggest";

export interface FeedbackDoorContext {
  title?: string;
  category?: string;
  ref?: IssueRef;
}

// Дверь входа (§1) — нейтральное стекло modelGlassBtn (та же формула, что «Поделиться»), не
// зелёная: одна дверь на объект, не соревнуется с главным действием экрана.
export function ContextFeedbackDoor({
  preset,
  context,
  className,
}: {
  preset: FeedbackDoorPreset;
  context?: FeedbackDoorContext;
  className?: string;
}) {
  const label = preset === "problem" ? "Сообщить о проблеме" : "Предложить";

  function handleClick() {
    navigate(issueNewPath({ ...context, type: preset === "problem" ? "problem" : undefined }));
  }

  return (
    <button
      type="button"
      className={`cfbDoor modelGlassBtn pressable${className ? ` ${className}` : ""}`}
      onClick={handleClick}
    >
      {preset === "problem" ? <ExclamationIcon /> : <BulbIcon />}
      {label}
    </button>
  );
}

// Компактный вариант двери (GAP-CSS docs/design/model.card.visual.md §6.2): пункт меню
// (иконка+текст, без pill-обвязки) — первое применение вне полноразмерной двери, «⋯»-меню
// комментария → «Пожаловаться» (§3.2). Тот же обработчик, что и ContextFeedbackDoor, другая обёртка.
export function ContextFeedbackMenuItem({ context, onNavigate }: { context?: FeedbackDoorContext; onNavigate?: () => void }) {
  return (
    <PopoverItem
      onClick={() => {
        onNavigate?.();
        navigate(issueNewPath({ ...context, type: "problem" }));
      }}
    >
      <ExclamationIcon /> Пожаловаться
    </PopoverItem>
  );
}

// Несъёмный контекст-чип над ghost-input заголовка (§3.2) — форма /issue/new подключит его,
// когда появится (MF-562). Тап по чипу — открыть исходный объект (проверить контекст перед
// отправкой), тап по ✕ — отвязать (ref снимается, заголовок остаётся обычным текстом).
export function ContextChip({ label, onDismiss, onOpen }: { label: string; onDismiss: () => void; onOpen?: () => void }) {
  return (
    <div className="cfbContextChip">
      <button type="button" className="cfbContextChipLabel pressable" onClick={onOpen} disabled={!onOpen}>
        {label}
      </button>
      <button type="button" className="cfbContextChipDismiss pressable" aria-label="Отвязать контекст" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}

export type IssueType = "idea" | "problem";

// Развилка «идея ≠ проблема» на форме подачи (§4.1, дизайн-ревью MF-1753) — нативный select:
// это выбор значения внутри одной формы, а не табы, которые обещают смену контента страницы.
export function TypeSelect({ value, onChange }: { value: IssueType; onChange: (value: IssueType) => void }) {
  const selectId = useId();

  return (
    <div className="cfbTypeSelect">
      <label className="cfbTypeSelectLabel" htmlFor={selectId}>
        Тип обращения
      </label>
      <select
        id={selectId}
        className="cfbTypeSelectControl"
        value={value}
        onChange={(event) => onChange(event.target.value as IssueType)}
      >
        <option value="idea">Сообщить об идее</option>
        <option value="problem">Сообщить о проблеме</option>
      </select>
      {value === "problem" ? (
        <div className="cfbTypeSelectHint">Проблема не попадает в общую ленту голосования — команда увидит её отдельно</div>
      ) : null}
    </div>
  );
}

// Метка «Проблема» в ленте/на странице идеи (§4.2) — дословно обычный Chip, не новый визуал:
// нейтральная, без иконки-точки статуса, заменяет статус-пилюлю+голосовалку у проблем.
export function ProblemTag() {
  return <Chip>Проблема</Chip>;
}

function ExclamationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18h6M10 21h4M8 14a4 4 0 1 1 8 0c0 1.6-.8 2.4-1.5 3.2-.4.4-.5.8-.5 1.3v.5h-4v-.5c0-.5-.1-.9-.5-1.3C8.8 16.4 8 15.6 8 14Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
