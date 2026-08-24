import { useState, type ReactNode } from "react";
import "./research.css";

// Сворачиваемая секция формы (§2.2): заголовок-`.pressable` разворачивает/схлопывает, справа
// счётчик «N из M» + зелёная точка-галочка, если ≥1 поле заполнено (беглый скан «где я уже
// поработал»). `defaultOpen` решает вызывающая сторона (§2.2: секции с данными агента — открыты,
// пустые — свёрнуты по умолчанию при первой посадке).

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform var(--dur-nav) var(--ease-out)" }}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface SectionProps {
  title: string;
  filledCount: number;
  totalCount: number;
  defaultOpen: boolean;
  children: ReactNode;
}

export function Section({ title, filledCount, totalCount, defaultOpen, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasData = filledCount > 0;
  return (
    <div className="rsSection" data-open={open || undefined}>
      <button type="button" className="rsSectionHeader pressable" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="rsSectionTitleRow">
          <ChevronIcon open={open} />
          <span className="rsSectionTitle">{title}</span>
        </span>
        <span className="rsSectionCount">
          {hasData ? <span className="rsSectionCheck" aria-hidden="true" /> : null}
          {filledCount} из {totalCount}
        </span>
      </button>
      {open ? <div className="rsSectionBody reveal">{children}</div> : null}
    </div>
  );
}
