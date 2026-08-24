import { useEffect, useState } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { useGuestLogin } from "@domains/access";
import type { SessionUser } from "@shared/types";
import { voteThread, votePost } from "../community/api.ts";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { voteModel } from "@domains/commerce";
import { useOverlay } from "@platform/overlay";
import { voteFeedComment, voteFeedPost, type VoteResult } from "./api.ts";
import "./feed.css";

// VoteArrows (docs/design/community.md §7.4, расширен feed.md §6.1/feed.post.editor.md §7.1) —
// тот же контракт/паттерн, что была .modelVote (market/model.tsx, теперь тоже зовёт этот
// компонент — MF-931 подключила третий/четвёртый subjectType 'thread'/'post', порог «повторилось
// дважды» пройден, третья копия JSX/CSS не заводится). model.tsx передаёт subjectType='model' —
// голосует через тот же voteModel, что и раньше, просто без собственной разметки.

export function voteDelta(prev: -1 | 0 | 1, next: -1 | 0 | 1): { up: number; down: number } {
  let up = 0;
  let down = 0;
  if (prev === 1) up -= 1;
  if (prev === -1) down -= 1;
  if (next === 1) up += 1;
  if (next === -1) down += 1;
  return { up, down };
}

// «Размытый счёт» первые 10 минут жизни поста (feed.md §3, анти-абьюз) — тильда + округление до
// ближайшего порядка величины, не точное число. Комментарии approx не используют (§7.1).
export function roundApproxScore(score: number): number {
  const sign = score < 0 ? -1 : 1;
  const abs = Math.abs(score);
  if (abs < 10) return score;
  const magnitude = 10 ** Math.floor(Math.log10(abs));
  return sign * Math.round(abs / magnitude) * magnitude;
}

function UpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M12 5l6 6M12 5 6 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M12 19l6-6M12 19l-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface VoteArrowsProps {
  // Гость видит и может тапнуть голосовалку (feed.md §3/§6.1: чтение и голосовалка публичны) —
  // null → overlay-промпт входа вместо запроса, голос сохраняется и уходит сам после логина
  // (guestintent.ts/guestresume.tsx).
  user: SessionUser | null;
  subjectType: "feed_post" | "feed_comment" | "thread" | "post" | "model";
  subjectId: string;
  votesUp: number;
  votesDown: number;
  myVote: -1 | 0 | 1;
  variant?: "compact" | "large";
  // Размытый счёт первые 10 минут (feed.md §3/§6.1) — только для постов, компонент сам не решает,
  // когда включать: вызывающая сторона передаёт факт (now - created_at < 10min).
  approx?: boolean;
  onVoted?: (result: VoteResult) => void;
}

// Тач-цель/аффорданс — общий примитив (компакт в карточке ленты/треда/поста, large — пост
// ленты/страница модели/треда целиком). Оптимистичный апдейт + откат при сетевой ошибке — один
// код на все пять subjectType.
export function VoteArrows({ user, subjectType, subjectId, votesUp, votesDown, myVote, variant = "compact", approx, onVoted }: VoteArrowsProps) {
  const overlay = useOverlay();
  const promptGuestLogin = useGuestLogin();
  const [voting, setVoting] = useState(false);
  const [local, setLocal] = useState({ votesUp, votesDown, myVote });

  useEffect(() => {
    setLocal({ votesUp, votesDown, myVote });
  }, [votesUp, votesDown, myVote]);

  async function handleVote(value: 1 | -1) {
    if (voting) return;
    if (!user) {
      if (subjectType === "model") {
        promptGuestLogin({ kind: "vote_model", modelId: subjectId, value, returnTo: window.location.pathname });
      } else {
        promptGuestLogin({ kind: "vote_feed", subjectType, subjectId, value, returnTo: window.location.pathname });
      }
      return;
    }
    const nextValue = local.myVote === value ? 0 : value;
    const delta = voteDelta(local.myVote, nextValue);
    const rollback = local;
    setLocal({ votesUp: local.votesUp + delta.up, votesDown: local.votesDown + delta.down, myVote: nextValue });
    setVoting(true);
    const voteFn =
      subjectType === "feed_post"
        ? voteFeedPost
        : subjectType === "feed_comment"
          ? voteFeedComment
          : subjectType === "thread"
            ? voteThread
            : subjectType === "post"
              ? votePost
              : voteModel;
    const result = await voteFn(subjectId, nextValue);
    setVoting(false);
    if (!result) {
      setLocal(rollback);
      overlay.toast({ severity: "warn", title: "Голос не сохранён" });
      return;
    }
    setLocal({ votesUp: result.votes_up, votesDown: result.votes_down, myVote: result.my_vote });
    onVoted?.(result);
  }

  const score = local.votesUp - local.votesDown;
  const display = approx ? `~${roundApproxScore(score)}` : String(score);
  const subjectLabel = subjectType === "feed_post" ? "пост" : subjectType === "feed_comment" ? "комментарий" : "публикацию";

  return (
    <div
      className="feedVote"
      data-variant={variant}
      data-labeled={subjectType !== "feed_comment" || undefined}
      role="group"
      aria-label={subjectType === "feed_post" ? "Рейтинг поста" : "Рейтинг"}
    >
      <button
        type="button"
        className="feedVoteBtn pressable"
        aria-label={`Голосовать за ${subjectLabel}, сейчас ${score} голосов`}
        aria-pressed={local.myVote === 1}
        data-active={local.myVote === 1 ? "up" : undefined}
        onClick={() => void handleVote(1)}
      >
        <UpIcon />
      </button>
      <span className="feedVoteCount">
        {subjectType !== "feed_comment" ? <span className="feedVoteCaption">Рейтинг</span> : null}
        <span aria-live="polite" aria-label={approx ? `Приблизительный рейтинг: ${score} голосов` : `Рейтинг: ${score} голосов`}>
          {display}
        </span>
      </span>
      <button
        type="button"
        className="feedVoteBtn pressable"
        aria-label={`Голосовать против ${subjectLabel}, сейчас ${score} голосов`}
        aria-pressed={local.myVote === -1}
        data-active={local.myVote === -1 ? "down" : undefined}
        onClick={() => void handleVote(-1)}
      >
        <DownIcon />
      </button>
    </div>
  );
}
