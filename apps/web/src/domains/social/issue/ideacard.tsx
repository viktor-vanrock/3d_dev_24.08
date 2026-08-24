import type { SessionUser } from "@shared/types";
import { relativeDate } from "@shared/lib";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { IDEA_CATEGORY_LABELS, IDEA_STATUS_META, type IdeaListItem } from "@domains/commerce";
import { issuePath, navigate } from "../../../router.ts";
import { StatusPill, Vote, type VoteDisabledReason } from "@shared/ui";
import { markdownToSnippet } from "./mdsnippet.ts";

// Карточка идеи в ленте `/issue` (docs/design/ideas.md §2) — gradient card-действие, вся площадь
// кликабельна кроме голосовалки в торце (§2 «она перехватывает тап»): голосовалка — вложенная
// кнопка, `stopPropagation` на её обёртке не даёт клику дойти до карточки-обёртки.
export function IdeaCard({
  idea,
  user,
  rank,
  onVote,
  onGuestVote,
}: {
  idea: IdeaListItem;
  user: SessionUser | null;
  // Ранг-акцент трендовой вкладки (§1.3) — только первые 3 карточки таба «Трендовые».
  rank?: number;
  onVote: (idea: IdeaListItem) => Promise<boolean | void>;
  onGuestVote: () => void;
}) {
  const meta = IDEA_STATUS_META[idea.status];
  const categoryLabel = IDEA_CATEGORY_LABELS[idea.category as keyof typeof IDEA_CATEGORY_LABELS] ?? idea.category;
  const isGuest = user === null;
  const isOwn = idea.is_author === true;
  const isArchived = idea.status === "archived" || idea.status === "duplicate";
  const reason: VoteDisabledReason | undefined = isGuest ? "guest" : isOwn ? "own" : isArchived ? "archived" : undefined;
  const snippet = markdownToSnippet(idea.body).slice(0, 240);

  function open() {
    navigate(issuePath(idea.id));
  }

  return (
    <div
      className="issueCard pressable"
      data-archived={idea.status === "archived" || idea.status === "duplicate" || undefined}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") open();
      }}
    >
      <div className="issueCardBody">
        <div className="issueCardEyebrow">
          {categoryLabel} · {relativeDate(idea.created_at)}
        </div>
        <div className="issueCardTitle">{idea.title}</div>
        {snippet ? <div className="issueCardSnippet">{snippet}</div> : null}
        {idea.status !== "proposed" ? (
          <div className="issueCardStatus">
            <StatusPill tone={meta.tone} level={meta.level} done={meta.done}>
              {meta.label}
            </StatusPill>
          </div>
        ) : null}
      </div>
      <div
        className="issueCardVote"
        data-rank={rank !== undefined && rank < 3 ? "top" : undefined}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Vote
          variant="compact"
          voteCount={idea.vote_count}
          hasVoted={idea.viewer_has_voted === true}
          reason={reason}
          onToggle={() => (isGuest ? onGuestVote() : onVote(idea))}
        />
      </div>
    </div>
  );
}
