import { relativeDate } from "@shared/lib";
import { navigate, researchFormPath } from "../../../router.ts";
import { AgentBadge, StatusPill, type StatusTone } from "@shared/ui";
import { QUEUE_FACET_COUNT, type ResearchConfidence, type ResearchQueueItem, type ResearchStatus } from "./api.ts";

// Строка очереди (§1.4). Один инстанс переиспользуется и в поисковой выдаче (researchsearch.tsx)
// частично — та рисует только бренд/модель/статус, полную строку собирает только этот компонент.

const STATUS_LABEL: Record<ResearchStatus, string> = {
  announced: "анонсирован",
  shipping: "выпускается",
  eol: "снят с производства",
  rumored: "слухи",
};

// dim для announced/eol/rumored, обычная заливка для shipping (§1.4: фаза жизни, не критичность).
const STATUS_TONE: Record<ResearchStatus, StatusTone> = {
  announced: "dim",
  shipping: "ok",
  eol: "dim",
  rumored: "dim",
};

const CONFIDENCE_LABEL: Record<ResearchConfidence, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
};

export function StatusChip({ status }: { status: ResearchStatus }) {
  return (
    <StatusPill tone={STATUS_TONE[status]} level={STATUS_TONE[status] === "ok" ? 2 : undefined}>
      {STATUS_LABEL[status]}
    </StatusPill>
  );
}

// Точечный индикатор полноты — статичный факт, не прогресс-бар (§1.4). Заполненные — мятные,
// пустые — контур `--border`.
export function CompletenessDots({ filled, total = QUEUE_FACET_COUNT }: { filled: number; total?: number }) {
  const clamped = Math.max(0, Math.min(total, filled));
  return (
    <span className="researchDots" role="img" aria-label={`заполнено ${clamped} из ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="researchDot" data-filled={i < clamped || undefined} aria-hidden="true" />
      ))}
    </span>
  );
}

function FlagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="researchRowFlagIcon">
      <path d="M6 3v18M6 4h11l-2.5 3.5L17 11H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ResearchQueueRow({ item, onPress }: { item: ResearchQueueItem; onPress?: () => void }) {
  const updated = item.updated_at ? relativeDate(item.updated_at) : "—";
  const open = () => navigate(researchFormPath(item.slug));
  return (
    <div
      className="researchRow pressable"
      role="button"
      tabIndex={0}
      onPointerDown={onPress}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") open();
      }}
      data-flagged={item.flagged || undefined}
    >
      <div className="researchRowIdentity">
        {item.flagged ? <FlagIcon /> : null}
        <div className="researchRowIdentityText">
          <div className="researchRowTitle">
            {item.brand} · {item.model}
          </div>
          <div className="researchRowSlug" data-updated={updated}>
            {item.slug}
          </div>
        </div>
      </div>
      <div className="researchRowMeta">
        <StatusChip status={item.status} />
        <CompletenessDots filled={item.filled_count} />
        <span className="researchRowConfidence">{item.confidence ? CONFIDENCE_LABEL[item.confidence] : "—"}</span>
        <span className="researchRowFilledBy">
          {item.filled_by_kind === "agent" ? <AgentBadge>{item.filled_by ?? "агент"}</AgentBadge> : item.filled_by ? `@${item.filled_by}` : "—"}
        </span>
        <span className="researchRowUpdated">{updated}</span>
      </div>
    </div>
  );
}

export function ResearchRowSkeleton() {
  return <div className="researchRowSkeleton" aria-hidden="true" />;
}
