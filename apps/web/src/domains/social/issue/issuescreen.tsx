import { useEffect, useRef, useState, type JSX } from "react";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { useGuestLogin } from "@domains/access";
import type { SessionUser } from "@shared/types";
import { AuroraBackground, Button, Chip, EmptyState, Eyebrow, Heading, SegmentToggle } from "@shared/ui";
import { resolveTier, useActivation } from "@shared/lib";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import "../projects/projects.css";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { IDEA_CATEGORY_LABELS, IDEA_STATUS_META, voteIdea, type IdeaCategory, type IdeaListItem, type IdeaStatus, type IdeaTab } from "@domains/commerce";
import { headerModeFor, issueNewPath, navigate } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { IdeaCard } from "./ideacard.tsx";
import { useIssueFeed } from "./issuestore.ts";
import "./issue.css";

// Лента идей `/issue` (MF-945, docs/design/ideas.md §1) — wide-раскладка (сестра «Проектов»,
// §1 «наследует wide-режим шапки»), сегмент-табы + чипы-фильтры + единый store (issuestore.ts)
// + одна колонка карточек-действий (§2) + двойная пагинация (§1.5).

const CATEGORY_CHIPS: IdeaCategory[] = ["catalog", "projects", "forum", "account", "other"];
// Статус-фильтр (§1.4): «предложена»/«дубликат»/«архив» скрыты — читательски-осмысленный ряд.
const STATUS_CHIPS: IdeaStatus[] = ["under_review", "planned", "in_progress", "done", "declined"];

const TAB_OPTIONS: { value: IdeaTab; label: string }[] = [
  { value: "popular", label: "Популярные" },
  { value: "new", label: "Новые" },
  { value: "trending", label: "Трендовые" },
];

export function IssueFeedScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const activation = useActivation();
  const tier = resolveTier(activation.activation, activation.printers);
  const feed = useIssueFeed();
  const sound = useInteractionSound();
  const promptGuestLogin = useGuestLogin();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Инфинит-скролл (§1.5): сентинел у низа ленты, тач-fallback «Показать ещё» — двойная
  // страховка, кнопка остаётся видимой всегда, IntersectionObserver — просто ещё один триггер
  // той же loadMore().
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !feed.hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) feed.loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.hasMore, feed.items?.length]);

  async function handleVote(idea: IdeaListItem): Promise<boolean> {
    const result = await voteIdea(idea.id);
    return result !== false;
  }

  function handleCta() {
    if (user === null) {
      promptGuestLogin();
      return;
    }
    navigate(issueNewPath());
  }

  const isGuestGate = feed.error === "unauthorized";

  return (
    <div className="home projectsWide" data-tier={tier}>
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={activation.printers} section={section} onSectionChange={onSectionChange} mode={headerModeFor("issue")} />
      </div>

      <main className="projectsWideBody issueFeedBody">
        <div className="issueHead">
          <div>
            <Eyebrow>Идеи сообщества · голосуй за будущее портала</Eyebrow>
            <Heading accent="Идеи" />
          </div>
          <div className="issueCtaDesktop">
            <Button variant="primary" onClick={handleCta}>
              Предложить идею
            </Button>
          </div>
        </div>

        <div className="issueControls">
          <SegmentToggle
            ariaLabel="Сортировка идей"
            options={TAB_OPTIONS}
            value={feed.tab}
            onChange={feed.setTab}
            onPress={sound.toggle}
          />
        </div>

        <div className="issueChipRow" data-row="category">
          <Chip selected={feed.category === undefined} onClick={() => feed.setCategory(undefined)} onPress={sound.toggle}>
            Все
          </Chip>
          {CATEGORY_CHIPS.map((category) => (
            <Chip key={category} selected={feed.category === category} onClick={() => feed.setCategory(category)} onPress={sound.toggle}>
              {IDEA_CATEGORY_LABELS[category]}
            </Chip>
          ))}
        </div>
        <div className="issueChipRow" data-row="status">
          <Chip selected={feed.status === undefined} onClick={() => feed.setStatus(undefined)} onPress={sound.toggle}>
            Все
          </Chip>
          {STATUS_CHIPS.map((status) => (
            <Chip key={status} selected={feed.status === status} onClick={() => feed.setStatus(status)} onPress={sound.toggle}>
              {IDEA_STATUS_META[status].label}
            </Chip>
          ))}
        </div>

        {isGuestGate ? (
          <EmptyState
            icon={<LockIcon />}
            title="Войдите, чтобы посмотреть идеи сообщества"
            sub="Лента идей и голосование доступны авторизованным участникам."
            action={
              <Button variant="primary" onClick={() => promptGuestLogin()}>
                Войти
              </Button>
            }
          />
        ) : feed.error === "error" ? (
          <EmptyState
            icon={<WarnIcon />}
            title="Не удалось загрузить идеи"
            action={
              <Button variant="secondary" icon={null} onClick={feed.retry}>
                Повторить
              </Button>
            }
          />
        ) : feed.loading || feed.items === null ? (
          <div className="issueList">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="issueCardSkeleton" />
            ))}
          </div>
        ) : feed.items.length === 0 ? (
          feed.filtersActive ? (
            <EmptyState
              icon={<SearchIcon />}
              title="Ничего не нашлось по фильтру. Сбросить?"
              action={
                <Button variant="secondary" icon={null} onClick={feed.reset}>
                  Сбросить
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<BulbIcon />}
              title="Пока нет идей. Предложите первую"
              action={
                <Button variant="primary" onClick={handleCta}>
                  Предложить идею
                </Button>
              }
            />
          )
        ) : (
          <>
            <RevealList items={feed.items}>
              {(idea, index) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  user={user}
                  rank={feed.tab === "trending" ? index : undefined}
                  onVote={handleVote}
                  onGuestVote={() => promptGuestLogin()}
                />
              )}
            </RevealList>

            {feed.loadMoreError ? (
              <div className="issueLoadMoreError">
                Не удалось догрузить · {" "}
                <button type="button" className="issueRetryInline pressable" onClick={feed.loadMore}>
                  Повторить
                </button>
              </div>
            ) : null}

            <div ref={sentinelRef} aria-hidden="true" />
            {feed.hasMore ? (
              <button type="button" className="issueShowMore pressable" onPointerDown={sound.tick} onClick={feed.loadMore} disabled={feed.loadingMore}>
                {feed.loadingMore ? "Загрузка…" : "Показать ещё"}
              </button>
            ) : null}
          </>
        )}
      </main>

      <div className="issueCtaMobile">
        <Button variant="primary" onClick={handleCta}>
          Предложить идею
        </Button>
      </div>
    </div>
  );
}

// Reveal догруженных карточек — по `setTimeout`, НЕ `requestAnimationFrame` (motion.md грабля:
// rAF в фоновой вкладке встанет на паузу и оставит карточку `opacity:0`, ideas.md §1.5). Первая
// страница рендерится сразу видимой (`revealed`), догруженный хвост — на кадр позже через
// setTimeout(0), только чтобы получить CSS-переход, а не мгновенный скачок.
function RevealList({ items, children }: { items: IdeaListItem[]; children: (idea: IdeaListItem, index: number) => JSX.Element }) {
  const [revealedCount, setRevealedCount] = useState(items.length);
  const knownCount = useRef(items.length);

  useEffect(() => {
    if (items.length <= knownCount.current) {
      knownCount.current = items.length;
      return;
    }
    knownCount.current = items.length;
    const timer = setTimeout(() => setRevealedCount(items.length), 0);
    return () => clearTimeout(timer);
  }, [items.length]);

  return (
    <div className="issueList">
      {items.map((idea, index) => (
        <div key={idea.id} className="issueCardReveal" data-revealed={index < revealedCount || undefined}>
          {children(idea, index)}
        </div>
      ))}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4 2 20h20L12 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18h6M10 21h4M8 14.5A5.5 5.5 0 1 1 16 14.5c-.8 1-1.3 1.7-1.3 3H9.3c0-1.3-.5-2-1.3-3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
