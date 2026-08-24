import { useEffect, useRef, useState } from "react";
// shared→platform: vote.tsx (UI-компонент в shared/ui) зовёт useOverlay (тост при отказе)
// и usePrefersReducedMotion. Развязка (опустить prefersReducedMotion в shared + прокинуть
// overlay пропсом, либо перенести vote в platform/domain) ОТЛОЖЕНА — см. MIGRATION.md,
// решение оператора (микроэтап 7.6). До неё — явное легатное исключение.
// eslint-disable-next-line boundaries/element-types -- отложенное shared→platform ребро, см. выше
import { useOverlay } from "@platform/overlay";
// eslint-disable-next-line boundaries/element-types -- отложенное shared→platform ребро, см. выше
import { usePrefersReducedMotion } from "@platform/theme";

/*
  Голосовалка идей (docs/design/ideas.md §5, components.md §Голосовалка, GAP-3) — upvote-only
  toggle, три варианта разметки (compact/large/inline), общая логика тапа/отката. В отличие от
  feed/vote.tsx VoteArrows (даунвоут, знает про API/auth) этот компонент — чистый UI+состояние:
  экраны сами решают откуда брать voteCount/hasVoted и куда стучаться, здесь только оптимистичный
  апдейт числа и отработка отказа `onToggle` (false/reject → откат + тихий тост).
*/

export type VoteVariant = "compact" | "large" | "inline";

// Почему голос недоступен обычным тапом-тоггла (ideas.md §5 «Disabled-кейсы»):
// - own — своя идея: стрелка dim, тап без эффекта (голосовать за себя нельзя).
// - guest — не авторизован: тап всё равно вызывает onToggle — экран открывает overlay-промпт
//   входа вместо реального голоса (компонент не знает про auth, только пробрасывает тап).
// - archived — архив/удалена: upvote скрыт совсем, виден только счётчик.
export type VoteDisabledReason = "own" | "guest" | "archived";

export interface VoteProps {
  variant?: VoteVariant;
  voteCount: number;
  hasVoted: boolean;
  reason?: VoteDisabledReason;
  // Тоггл — экран делает реальный запрос и возвращает успех; `false`/reject/throw → откат
  // локального оптимистичного счётчика + тихий тост (ideas.md §5 «Оптимистичный апдейт»).
  onToggle?: () => boolean | void | Promise<boolean | void>;
  className?: string;
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M12 5l6 6M12 5 6 11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Count-up ±1 (motion.md, ideas.md §5.2) — короткий подкрут к новому числу, не мгновенный скачок;
// выключен при prefers-reduced-motion (тогда число меняется сразу).
function useCountUp(target: number, reduced: boolean): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (reduced) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const duration = 220;
    let frame: number;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(from + (target - from) * t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = target;
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return display;
}

export function Vote({ variant = "compact", voteCount, hasVoted, reason, onToggle, className }: VoteProps) {
  const overlay = useOverlay();
  const reduced = usePrefersReducedMotion();
  const [local, setLocal] = useState({ count: voteCount, voted: hasVoted });
  const [bumping, setBumping] = useState(false);

  useEffect(() => {
    setLocal({ count: voteCount, voted: hasVoted });
  }, [voteCount, hasVoted]);

  const displayCount = useCountUp(local.count, reduced);
  const isOwn = reason === "own";
  const isGuest = reason === "guest";
  const isArchived = reason === "archived";

  async function handleTap() {
    if (isOwn) return;
    if (isGuest) {
      onToggle?.();
      return;
    }
    const nextVoted = !local.voted;
    const rollback = local;
    setLocal({ count: local.count + (nextVoted ? 1 : -1), voted: nextVoted });
    setBumping(true);
    let ok: boolean | void;
    try {
      ok = await onToggle?.();
    } catch {
      ok = false;
    }
    setBumping(false);
    if (ok === false) {
      setLocal(rollback);
      overlay.toast({ severity: "warn", title: "Не удалось. Попробуйте ещё" });
    }
  }

  const ariaLabel = `Голосовать за идею, сейчас ${local.count} голосов`;

  if (variant === "large") {
    return (
      <div className="uiVoteLarge" data-variant={variant} data-bump={bumping || undefined}>
        <div className="uiVoteLargeCount" aria-live="polite">
          {displayCount}
        </div>
        {isOwn ? (
          <span className="uiVoteLargeOwn">Ваша идея</span>
        ) : (
          <button
            type="button"
            className="uiVoteLargeBtn pressable"
            aria-pressed={local.voted}
            aria-label={ariaLabel}
            disabled={isArchived}
            data-voted={local.voted || undefined}
            onClick={() => void handleTap()}
          >
            {local.voted ? (
              <>
                <CheckIcon /> Вы голосовали
              </>
            ) : (
              <>
                <ArrowIcon /> Голосовать
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className={`uiVoteInline${className ? ` ${className}` : ""}`} data-variant={variant} data-bump={bumping || undefined}>
        <span className="uiVoteInlineCount" aria-live="polite">
          {displayCount}
        </span>
        <button
          type="button"
          className="uiVoteInlineBtn pressable"
          aria-pressed={local.voted}
          aria-label={ariaLabel}
          disabled={isOwn || isArchived}
          data-voted={local.voted || undefined}
          onClick={() => void handleTap()}
        >
          {local.voted ? (
            <>
              <CheckIcon /> Проголосовали
            </>
          ) : (
            <>
              <ArrowIcon /> Проголосовать
            </>
          )}
        </button>
      </div>
    );
  }

  // compact — короткая Reddit-подобная пилюля: стрелка и счётчик читаются одной строкой,
  // весь блок остаётся единым tap-target.
  if (isArchived) {
    return (
      <div className={`uiVoteCompact${className ? ` ${className}` : ""}`} data-variant={variant}>
        <span className="uiVoteCompactCount" aria-live="polite">
          {displayCount}
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`uiVoteCompact pressable${className ? ` ${className}` : ""}`}
      data-variant={variant}
      data-voted={local.voted || undefined}
      data-bump={bumping || undefined}
      aria-pressed={local.voted}
      aria-label={ariaLabel}
      disabled={isOwn}
      onClick={() => void handleTap()}
    >
      <ArrowIcon />
      <span className="uiVoteCompactCount" aria-live="polite">
        {displayCount}
      </span>
    </button>
  );
}
