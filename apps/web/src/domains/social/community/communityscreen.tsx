import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { listCommunityFeed, type FeedPost } from "../feed/api.ts";
import { FeedPostCard, FeedPostCardSkeleton } from "../feed/postcard.tsx";
import { VoteArrows } from "../feed/vote.tsx";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { useOverlay } from "@platform/overlay";
import { communitiesPath, communityPath, feedPostPath, navigate, threadPath } from "../../../router.ts";
import { relativeDate } from "@shared/lib";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; развязка отложена до pages/DI-этапа. См. apps/web/MIGRATION.md.
import { MarkdownEditor } from "@domains/commerce";
import { communityFaviconUrl } from "./favicon.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, SegmentToggle, Button, EmptyState, Heading } from "@shared/ui";
import {
  authorDisplayName,
  createThread,
  formatMemberCount,
  formatPostCount,
  formatThreadCount,
  getCommunity,
  joinCommunity,
  leaveCommunity,
  listThreads,
  THREAD_CONTENT_MAX_LENGTH,
  THREAD_MAX_TAGS,
  THREAD_TITLE_MAX_LENGTH,
  CommunityApiError,
  type Community,
  type CommunityKind,
  type Thread,
  type ThreadType,
  type VoteResult,
} from "./api.ts";
import { CommunityKindBadge, RoleBadge, ThreadTypeBadge } from "./badges.tsx";
import "./community.css";
import { communityDisplayName } from "./displayname.ts";
import { communityErrorMessage } from "./errors.ts";
// Страница сообщества `/community/:slug` (docs/design/community.md §2). Primary-CTA
// переключается «Вступить»⇄«+ Новый тред» по членству (§2.2–2.3) — никогда обе зелёные разом.

type LoadState = "loading" | "ready" | "error";

// Логотип бренда в шапке (2026-07-21, живая проверка — раньше шапка была голым текстом без
// единого визуального якоря). website → favicon (тот же keyless приём, что "Мои сабы"), иначе
// буква на закрашенном круге — никогда не пусто и не "битая картинка".
function CommunityLogo({ name, website }: { name: string; website: string | null }) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = website ? communityFaviconUrl(website) : null;
  return (
    <span className="cmtyLogo" aria-hidden="true">
      {src && !imgFailed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setImgFailed(true)} />
      ) : (
        communityDisplayName(name).slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

// "Все сабы" бренда (2026-07-21) — vendor-саб видит свои machine-сабы, machine-саб видит вендора
// и сиблингов (§ related_communities, communities.ts#fetchRelatedCommunities). Чипы = сами кнопки
// перехода, отдельного модального "показать все" не нужно — семья обычно короткая (1 вендор + N
// моделей), длинный список ушёл бы в горизонтальный скролл того же ряда.
function RelatedCommunitiesRow({ items }: { items: Community["related_communities"] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="cmtyRelatedRow" aria-label="Связанные сабы бренда">
      <span className="cmtyRelatedLabel">Все сабы</span>
      {items.map((item) => (
        <Button
          key={item.id}
          type="button"
          variant="ghost"
          icon={null}
          className="cmtyRelatedChip"
          onClick={() => navigate(communityPath(item.slug))}
        >
          <CommunityKindBadge kind={item.kind as CommunityKind} compact />
          {communityDisplayName(item.name)}
        </Button>
      ))}
    </div>
  );
}

export function CommunityScreen({
  user,
  section,
  onSectionChange,
  slug,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  slug: string;
}) {
  const overlay = useOverlay();
  const sound = useInteractionSound();
  const [community, setCommunity] = useState<Community | null | undefined>(undefined);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadLoadState, setThreadLoadState] = useState<LoadState>("loading");
  const [typeFilter, setTypeFilter] = useState<ThreadType | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);

  // Официальные (vendor/machine) сабы — витрина co-authored новостей от контент-агентов
  // (docs/epics/agent.accounts.md), реальный контент там — посты, не треды (та функция для
  // custom-клубов). 2026-07-21: страница саба раньше показывала ТОЛЬКО треды даже для официальных
  // сабов — оператор поймал вживую (клик "Открыть сообщество" на посте → пустая страница тредов,
  // хотя пост реально привязан к этому сабу). Правильный фикс — не редиректить мимо страницы
  // саба, а показать посты НА НЕЙ, вкладкой рядом с тредами.
  const official = community?.kind === "vendor" || community?.kind === "machine";
  const [manualTab, setManualTab] = useState<"posts" | "threads" | null>(null);
  const contentTab = manualTab ?? (official ? "posts" : "threads");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [postsLoadState, setPostsLoadState] = useState<LoadState>("loading");
  const [postsLoadingMore, setPostsLoadingMore] = useState(false);
  const postsNextCursorRef = useRef<string | null>(null);

  function loadPosts(communityId: string) {
    setPostsLoadState("loading");
    void listCommunityFeed(communityId, { limit: 20 }).then((result) => {
      if (!result) {
        setPostsLoadState("error");
        return;
      }
      setPosts(result.items);
      postsNextCursorRef.current = result.next_cursor;
      setPostsLoadState("ready");
    });
  }

  useEffect(() => {
    if (community && contentTab === "posts") loadPosts(community.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перезагрузка только по смене сообщества/вкладки
  }, [community?.id, contentTab]);

  function loadMorePosts() {
    if (!community) return;
    const cursor = postsNextCursorRef.current;
    if (!cursor || postsLoadingMore) return;
    setPostsLoadingMore(true);
    void listCommunityFeed(community.id, { limit: 20, cursor }).then((result) => {
      setPostsLoadingMore(false);
      if (!result) return;
      setPosts((prev) => [...prev, ...result.items]);
      postsNextCursorRef.current = result.next_cursor;
    });
  }

  useEffect(() => {
    let cancelled = false;
    setCommunity(undefined);
    void getCommunity(slug).then((result) => {
      if (!cancelled) setCommunity(result);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function loadThreads(communityId: string, type: ThreadType | null) {
    setThreadLoadState("loading");
    void listThreads(communityId, { type: type ?? undefined }).then((result) => {
      if (!result) {
        setThreadLoadState("error");
        return;
      }
      setThreads(result.items);
      nextCursorRef.current = result.next_cursor;
      setThreadLoadState("ready");
    });
  }

  useEffect(() => {
    if (community) loadThreads(community.id, typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перезагрузка только по смене сообщества/фильтра
  }, [community?.id, typeFilter]);

  function loadMoreThreads() {
    if (!community) return;
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    void listThreads(community.id, { type: typeFilter ?? undefined, cursor }).then((result) => {
      setLoadingMore(false);
      if (!result) return;
      setThreads((prev) => [...prev, ...result.items]);
      nextCursorRef.current = result.next_cursor;
    });
  }

  async function handleJoin() {
    if (!community || joinBusy) return;
    setJoinBusy(true);
    const ok = await joinCommunity(community.id);
    setJoinBusy(false);
    if (!ok) {
      overlay.toast({ severity: "critical", title: "Не удалось вступить" });
      return;
    }
    sound.toggle();
    setCommunity((prev) => (prev ? { ...prev, viewer_role: "member" } : prev));
  }

  async function handleLeave() {
    if (!community || joinBusy) return;
    setJoinBusy(true);
    const result = await leaveCommunity(community.id);
    setJoinBusy(false);
    if (result !== true) {
      overlay.toast({ severity: "warn", title: communityErrorMessage(result.error) });
      return;
    }
    sound.toggle();
    setCommunity((prev) => (prev ? { ...prev, viewer_role: null } : prev));
  }

  function openNewThread() {
    if (!community) return;
    sound.tick();
    const handle = overlay.modal({
      title: "Новый тред",
      content: (
        <CreateThreadForm
          communityId={community.id}
          onClose={() => handle.close()}
          onCreated={(thread) => {
            handle.close();
            navigate(threadPath(thread.id));
          }}
        />
      ),
    });
  }

  function handleThreadVoted(threadId: string, result: VoteResult) {
    setThreads((prev) =>
      prev.map((thread) => (thread.id === threadId ? { ...thread, votes_up: result.votes_up, votes_down: result.votes_down } : thread)),
    );
  }

  const isMember = community ? community.viewer_role !== null : false;

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} onBack={() => navigate(communitiesPath())} />
      </div>
      <main className="homeContent cmtyContent">
        {community === undefined ? null : community === null ? (
          <EmptyState
            icon={<PeopleIcon />}
            title="Сообщество не найдено"
            sub="Возможно, оно было удалено или ссылка устарела."
            action={
              <Button type="button" className="uiButton pressable" variant="secondary" onClick={() => navigate(communitiesPath())}>
                К сообществам
              </Button>
            }
          />
        ) : (
          <>
            <section className="cmtyHead" aria-label={`Сообщество ${communityDisplayName(community.name)}`}>
              <div className="cmtyHeadTop">
                <CommunityLogo name={community.name} website={community.website ?? null} />
                <div className="cmtyHeadTopCopy">
                  <CommunityKindBadge kind={community.kind as CommunityKind} />
                  <div className="cmtyHeadNameRow">
                    <Heading size="md">{communityDisplayName(community.name)}</Heading>
                    <RoleBadge role={community.viewer_role} />
                  </div>
                </div>
              </div>
              {community.description ? <p className="cmtyHeadDesc">{community.description}</p> : null}
              <RelatedCommunitiesRow items={community.related_communities} />
              <div className="cmtyHeadMetaRow">
                <span className="cmtyHeadMeta">
                  {formatMemberCount(community.member_count)} · {formatThreadCount(community.thread_count)}
                </span>
                {!isMember ? (
                  <Button type="button" className="uiButton pressable" variant="primary" loading={joinBusy} onClick={() => void handleJoin()}>
                    <span>Вступить</span>
                  </Button>
                ) : (
                  <Button type="button" className="uiButton pressable" variant="secondary" loading={joinBusy} onClick={() => void handleLeave()}>
                    Выйти
                  </Button>
                )}
              </div>
            </section>

            {official ? (
              <div className="cmtyContentTabBar">
                <SegmentToggle
                  ariaLabel="Раздел сообщества"
                  value={contentTab}
                  onChange={(next) => {
                    sound.toggle();
                    setManualTab(next);
                  }}
                  options={[
                    { value: "posts" as const, label: "Новости" },
                    { value: "threads" as const, label: "Обсуждения" },
                  ]}
                />
              </div>
            ) : null}

            {contentTab === "posts" ? (
              <>
                {postsLoadState === "error" ? (
                  <div className="cmtyLoadError">
                    <span>Не удалось загрузить посты</span>
                    <Button type="button" className="uiButton pressable" variant="secondary" onClick={() => loadPosts(community.id)}>
                      Повторить
                    </Button>
                  </div>
                ) : null}

                {postsLoadState === "loading" ? (
                  <div className="cmtyThreadList">
                    {Array.from({ length: 3 }, (_, i) => (
                      <FeedPostCardSkeleton key={i} />
                    ))}
                  </div>
                ) : null}

                {postsLoadState === "ready" && posts.length === 0 ? (
                  <EmptyState icon={<DiscussionIcon />} title="Новостей пока нет" sub="Здесь появятся посты об этом бренде/модели." />
                ) : null}

                {postsLoadState === "ready" && posts.length > 0 ? (
                  <>
                    <div className="cmtyThreadList stagger-reveal">
                      {posts.map((post) => (
                        <FeedPostCard key={post.id} user={user} post={post} onOpen={() => navigate(feedPostPath(post.id))} />
                      ))}
                    </div>
                    {postsNextCursorRef.current ? (
                      <Button type="button" className="cmtyLoadMore uiButton pressable" variant="secondary" loading={postsLoadingMore} onClick={loadMorePosts}>
                        {postsLoadingMore ? "Загружаю…" : "Показать ещё"}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              <>
                <div className="cmtyThreadBar">
                  <SegmentToggle
                    ariaLabel="Тип тредов"
                    value={typeFilter ?? "all"}
                    onChange={(next) => {
                      sound.toggle();
                      setTypeFilter(next === "all" ? null : next);
                    }}
                    options={[
                      { value: "all" as const, label: "Все" },
                      { value: "discussion" as const, label: "Обсуждения" },
                      { value: "question" as const, label: "Вопросы" },
                    ]}
                  />
                  <Button
                    type="button"
                    className="uiButton pressable"
                    variant={isMember ? "primary" : "secondary"}
                    onClick={openNewThread}
                  >
                    <span>+ Новый тред</span>
                  </Button>
                </div>

                {threadLoadState === "error" ? (
                  <div className="cmtyLoadError">
                    <span>Не удалось загрузить треды</span>
                    <Button type="button" className="uiButton pressable" variant="secondary" onClick={() => loadThreads(community.id, typeFilter)}>
                      Повторить
                    </Button>
                  </div>
                ) : null}

                {threadLoadState === "loading" ? <ThreadSkeletonList /> : null}

                {threadLoadState === "ready" && threads.length === 0 ? (
                  <EmptyState
                    icon={<DiscussionIcon />}
                    title="Тредов пока нет. Начните обсуждение"
                    action={
                      <Button type="button" className="uiButton pressable" variant="secondary" onClick={openNewThread}>
                        Новый тред
                      </Button>
                    }
                  />
                ) : null}

                {threadLoadState === "ready" && threads.length > 0 ? (
                  <>
                    <div className="cmtyThreadList stagger-reveal">
                      {threads.map((thread, index) => (
                        <ThreadRow key={thread.id} thread={thread} index={index} user={user} onVoted={handleThreadVoted} />
                      ))}
                    </div>
                    {nextCursorRef.current ? (
                      <Button type="button" className="cmtyLoadMore uiButton pressable" variant="secondary" loading={loadingMore} onClick={loadMoreThreads}>
                        {loadingMore ? "Загружаю…" : "Показать ещё"}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ThreadRow({
  thread,
  index,
  user,
  onVoted,
}: {
  thread: Thread;
  index: number;
  user: SessionUser;
  onVoted: (threadId: string, result: VoteResult) => void;
}) {
  const sound = useInteractionSound();
  const open = () => navigate(threadPath(thread.id));

  return (
    <div className="cmtyThreadCard reveal" style={{ ["--i" as string]: index }}>
      <Button variant="ghost" icon={null}
        type="button"
        className="cmtyThreadCardBody pressable"
        onPointerDown={sound.tick}
        onClick={open}
      >
        <div className="cmtyThreadCardHead">
          <ThreadTypeBadge type={thread.type} solved={thread.type === "question" && thread.accepted_post_id !== null} />
          {thread.pinned ? <span className="cmtyPinned">закреплён</span> : null}
        </div>
        <div className="cmtyThreadCardTitle">{thread.title}</div>
        <div className="cmtyThreadCardSnippet">
          <span className="cmtyThreadCardContent">{thread.content}</span>
          <span className="cmtyThreadCardPostCount">{formatPostCount(thread.post_count)}</span>
        </div>
        {thread.type === "question" && thread.tags.length > 0 ? (
          <div className="cmtyThreadCardTags">
            {thread.tags.map((tag) => (
              <span key={tag} className="cmtyTag">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
        <div className="cmtyThreadCardMeta">
          {authorDisplayName(thread.author_id, user)} · {relativeDate(thread.created_at)}
        </div>
      </Button>
      <div className="cmtyThreadCardVote">
        <span className="cmtyThreadCardVoteLabel">Голоса</span>
        <VoteArrows
          user={user}
          subjectType="thread"
          subjectId={thread.id}
          votesUp={thread.votes_up}
          votesDown={thread.votes_down}
          // GAP-API (заявка Back): GET /communities/:id/threads не отдаёт my_vote зрителя (в
          // отличие от GET /models/:id) — честный 0 до первого голоса в этой сессии, не выдумываем.
          myVote={0}
          onVoted={(result) => onVoted(thread.id, result)}
        />
      </div>
    </div>
  );
}

function CreateThreadForm({
  communityId,
  onClose,
  onCreated,
}: {
  communityId: string;
  onClose: () => void;
  onCreated: (thread: Thread) => void;
}) {
  const sound = useInteractionSound();
  const overlay = useOverlay();
  const [type, setType] = useState<ThreadType>("discussion");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmedTitle = title.trim();
  const titleValid = trimmedTitle.length > 0 && trimmedTitle.length <= THREAD_TITLE_MAX_LENGTH;
  const contentValid = content.trim().length > 0 && content.length <= THREAD_CONTENT_MAX_LENGTH;
  const canSubmit = titleValid && contentValid;

  function addTag() {
    const cleaned = tagInput.trim().toLowerCase();
    setTagInput("");
    if (!cleaned) return;
    if (tags.includes(cleaned)) return;
    if (tags.length >= THREAD_MAX_TAGS) {
      overlay.toast({ severity: "info", title: `До ${THREAD_MAX_TAGS} тегов` });
      return;
    }
    setTags((prev) => [...prev, cleaned]);
  }

  async function submit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const thread = await createThread(communityId, {
        type,
        title: trimmedTitle,
        content,
        tags: type === "question" ? tags : undefined,
      });
      sound.cta();
      onCreated(thread);
    } catch (err) {
      setError(communityErrorMessage(err instanceof CommunityApiError ? err.code : "unknown"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cmtyForm cmtyThreadForm">
      <SegmentToggle
        ariaLabel="Тип треда"
        value={type}
        onChange={(next) => {
          sound.toggle();
          setType(next);
        }}
        options={[
          { value: "discussion" as const, label: "Обсуждение" },
          { value: "question" as const, label: "Вопрос" },
        ]}
      />

      <label className="cmtyFormLabel" htmlFor="cmtyThreadTitle">
        Заголовок
      </label>
      <input
        id="cmtyThreadTitle"
        className="uiInput"
        value={title}
        maxLength={THREAD_TITLE_MAX_LENGTH}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Почему профиль PLA плывёт на второй пластине?"
      />

      <label className="cmtyFormLabel" htmlFor="cmtyThreadContent">
        Текст
      </label>
      <MarkdownEditor
        id="cmtyThreadContent"
        value={content}
        onChange={setContent}
        fieldLabel="Текст"
        imageDisabledHint="Картинки в постах сообщества скоро появятся (MF-744)"
      />
      {content.length > THREAD_CONTENT_MAX_LENGTH ? (
        <div className="marketFieldError">Текст — до {THREAD_CONTENT_MAX_LENGTH.toLocaleString("ru-RU")} символов</div>
      ) : null}

      {type === "question" ? (
        <>
          <label className="cmtyFormLabel" htmlFor="cmtyThreadTags">
            Теги (до {THREAD_MAX_TAGS}, только для вопроса)
          </label>
          <div className="cmtyTagInputRow">
            {tags.map((tag) => (
              <span key={tag} className="cmtyTag cmtyTagRemovable">
                #{tag}
                <Button variant="ghost" icon={null} type="button" aria-label={`Убрать тег ${tag}`} onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}>
                  ✕
                </Button>
              </span>
            ))}
            <input
              id="cmtyThreadTags"
              className="uiInput cmtyTagInput"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder="добавить тег…"
            />
          </div>
        </>
      ) : null}

      {error ? <div className="marketFieldError">{error}</div> : null}

      <div className="cmtyFormActions">
        <Button type="button" className="uiButton pressable" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button type="button" className="uiButton pressable" variant="primary" disabled={!canSubmit} loading={saving} onClick={() => void submit()}>
          <span>{saving ? "Публикую…" : "Опубликовать"}</span>
        </Button>
      </div>
    </div>
  );
}

function ThreadSkeletonList() {
  return (
    <div className="cmtySkeletonGrid" aria-hidden="true" style={{ gridTemplateColumns: "1fr" }}>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="cmtySkeletonTile">
          <div className="cmtySkeletonLine" style={{ width: "30%" }} />
          <div className="cmtySkeletonLine" style={{ width: "70%" }} />
          <div className="cmtySkeletonLine" style={{ width: "50%" }} />
        </div>
      ))}
    </div>
  );
}

function PeopleIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 8.5a2.6 2.6 0 1 0 0-5.2M18.5 19c0-2.4-1.7-4.3-4-4.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function DiscussionIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.5h16v10H9l-4 3.5v-3.5H4v-10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
