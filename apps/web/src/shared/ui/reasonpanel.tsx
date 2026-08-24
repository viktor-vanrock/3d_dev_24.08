import type { ReactNode } from "react";

/*
  Блок публичной причины (docs/design/ideas.md §3.3, components.md §Блок публичной причины,
  GAP-4) — панель «финальный статус + причина (+ ссылка)» для терминальных статусов идеи.
  Рендерится ТОЛЬКО для tone="danger" (отклонена) и tone="dim" (дубликат) — для любого другого
  статуса компонент возвращает null, вызывающий экран не должен решать это сам.
*/

export type ReasonPanelTone = "danger" | "dim";

export interface ReasonPanelProps {
  // Статус идеи как есть (например tone из IDEA_STATUS_META, включая "ok"/"warn") — панель сама
  // решает, показываться ли: рендерится только для "danger"/"dim", иначе — null.
  tone: string | null | undefined;
  title: ReactNode;
  reason: ReactNode;
  // Обязательна для дубликата (ideas.md §3.3) — крупная тач-ссылка на каноническую идею.
  canonicalHref?: string;
  canonicalLabel?: string;
}

function DotIcon() {
  return <span className="uiReasonPanelDot" aria-hidden="true" />;
}

export function ReasonPanel({ tone, title, reason, canonicalHref, canonicalLabel = "Смотреть оригинал" }: ReasonPanelProps) {
  if (tone !== "danger" && tone !== "dim") return null;
  return (
    <div className="uiReasonPanel" data-tone={tone} role="note">
      <div className="uiReasonPanelHead">
        <DotIcon />
        <span className="uiReasonPanelTitle">{title}</span>
      </div>
      <p className="uiReasonPanelText">{reason}</p>
      {canonicalHref ? (
        <a className="uiReasonPanelLink pressable" href={canonicalHref}>
          → {canonicalLabel}
        </a>
      ) : null}
    </div>
  );
}
