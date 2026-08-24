import { issuePath, modelPath, navigate } from "../../router.ts";
import { StatusPill } from "@shared/ui";
import { ProblemTag } from "./contextfeedback.tsx";
import { IDEA_STATUS_META, type IdeaStatus, type IdeaSummary } from "./ideas.ts";
import type { MakeStatus, MakeSummary } from "./makes.ts";
import { relativeDate } from "./market.tsx";

// Строки секций «Мои идеи»/«Мои печати» профиля (вынесены из profile.tsx MF-911).

// «Мои печати» (MF-777, слайс MF-27/MF-395, ЛК MF-15) — облегчённая строка по образцу «Моих
// идей» ниже: любой статус (draft/pending/published/hidden), это свой след автора, а не
// публичная галерея (та — /makes, только published). Своей страницы Make ещё нет (MF-394) —
// строка ведёт на карточку модели, тот же временный приём, что IdeaRow → /issue/:id до сборки
// страницы идеи.
export const MAKE_STATUS_META: Record<MakeStatus, { label: string; tone: "ok" | "warn" | "danger" | "dim" }> = {
  draft: { label: "Черновик", tone: "dim" },
  pending: { label: "На модерации", tone: "warn" },
  published: { label: "Опубликован", tone: "ok" },
  hidden: { label: "Скрыт", tone: "danger" },
};

// Строка «Мои идеи» (docs/design/feedback.entrypoints.md §6.1) — облегчённый вариант карточки
// ленты `/issue` (ideas.md §2): заголовок+статус+голоса+возраст, без интерактивной голосовалки
// (это просмотр судьбы своих идей, не лента для голосования).
export function IdeaRow({ idea }: { idea: IdeaSummary }) {
  // Cast: idea.status is `string` in generated schema (may include future values like
  // "hidden"/"removed" not yet in IDEA_STATUS_META) — fall back to dim pill for unknowns.
  const meta = IDEA_STATUS_META[idea.status as IdeaStatus] ?? { label: idea.status, tone: "dim" as const };
  const isOpenProblem = idea.type === "problem" && idea.status === "proposed";
  return (
    <div
      className="ideaRow pressable"
      onClick={() => navigate(issuePath(idea.id))}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") navigate(issuePath(idea.id));
      }}
    >
      <div className="ideaRowMain">
        <div className="ideaRowTitle">{idea.title}</div>
        <div className="ideaRowMeta">
          <span>▲ {idea.vote_count}</span>
          <span className="ideaRowDot" aria-hidden="true">
            ·
          </span>
          <span>{relativeDate(idea.last_activity_at)}</span>
        </div>
      </div>
      {isOpenProblem ? (
        <ProblemTag />
      ) : (
        <StatusPill tone={meta.tone} level={meta.level} done={meta.done}>
          {meta.label}
        </StatusPill>
      )}
    </div>
  );
}

// Строка «Мои печати» (MF-777) — тот же облегчённый приём, что IdeaRow выше: заголовок модели+
// статус+рейтинг+возраст, без карточки-галереи (та живёт в /makes, публичной галерее). Ведёт на
// карточку модели — своей страницы у Make ещё нет (MF-394).
export function MakeRow({ make }: { make: MakeSummary }) {
  const meta = MAKE_STATUS_META[make.status];
  return (
    <div
      className="ideaRow pressable"
      onClick={() => navigate(modelPath(make.model_id))}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") navigate(modelPath(make.model_id));
      }}
    >
      <div className="ideaRowMain">
        <div className="ideaRowTitle">{make.model_title}</div>
        <div className="ideaRowMeta">
          {make.printability_rating ? <span>{"★".repeat(make.printability_rating)}</span> : null}
          <span>▲ {make.likes_count}</span>
          <span className="ideaRowDot" aria-hidden="true">
            ·
          </span>
          <span>{relativeDate(make.created_at)}</span>
        </div>
      </div>
      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
    </div>
  );
}

export function PrintIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9V4h12v5M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v6H6v-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BulbIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18h6M10 21h4M8 14.5A5.5 5.5 0 1 1 16 14.5c-.8 1-1.7 1.3-3H9.3c0-1.3-.5-2-1.3-3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}