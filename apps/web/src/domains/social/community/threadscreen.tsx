import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { VoteArrows } from "../feed/vote.tsx";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, разрядка отложена до pages/DI (Этап 10). Cм. MIGRATION.md.
import "@pages/home/home.css";
import { relativeDate } from "@shared/lib";
import { MarkdownBody, AuroraBackground, Button, EmptyState, Eyebrow, Heading } from "@shared/ui";
// eslint-disable-next-line boundaries/element-types -- легатное межданное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; разрядка отложена до pages/DI-этапа. Cм. apps/web/MIGRATION.md.
import { MarkdownEditor } from "@domains/commerce";
import { useOverlay } from "@platform/overlay";
import { communityPath, communitiesPath, navigate } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import {
  acceptPost,
  authorDisplayName,
  createPost,
  formatPostCount,
  getCommunity,
  getThread,
  POST_CONTENT_MAX_LENGTH,
  type Community,
  type Post,
  type PostKind,
  type Thread,
  type VoteResult,
  CommunityApiError,
} from "./api.ts";
import { ThreadTypeBadge } from "./badges.tsx";
import "./community.css";
import { communityErrorMessage } from "./errors.ts";
import { FlagDialog } from "./flagdialog.tsx";
import type { ModerationTargetType } from "./moderation.ts";
import { useFlipReorder } from "@platform/theme";
// eslint-disable-next-line boundaries/element-types -- легатное межданное ребро (Этап 8): social→printing (превью карточки принтера в треде-обсуждении принтера). Разрядка отложена до pages/DI. Cм. MIGRATION.md.
import { printerCommunityPreviewById } from "@domains/printing";

// Страница треда `/thread/:id` (docs/design/community.md §3). «Отметить принятым» — тройное
// условие рендера (§3.5), не dim-заглушка: автор вопроса + kind='answer' + type='question'.
// Пересортировка постов после accept — не клиентская (§3.5/§7.5): сервер уже отдаёт posts[] в
// нужном порядке на каждый GET, здесь просто перезапрашивается тред; визуальный переезд карточек
// на новые позиции — FLIP (useFlipReorder, MF-932).

// Единая ошибка "не найден/не удалось" (не различаем 404 vs 500 клиентом) — тот же приём, что
// market/model.tsx: getThread() уже уплощает обе причины в null, различить нечем без правки
// API-клиента под то, что сегодня и так не различает ни одна другая страница проекта.
type LoadState = "loading" | "ready" | "error";

export function ThreadScreen({
  user,
  section,
  onSectionChange,
  id,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  id: string;
}) {
  const overlay = useOverlay();
  const printerPreview = printerCommunityPreviewById(id);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [thread, setThread] = useState<Thread | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [community, setCommunity] = useState<Community | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ postId: string; authorLabel: string } | null>(null);
  const [flagTarget, setFlagTarget] = useState<{ type: ModerationTargetType; id: string } | null>(null);
  const [hiddenAfterFlag, setHiddenAfterFlag] = useState(false);
  const [hiddenPostIds, setHiddenPostIds] = useState<string[]>([]);
  const threadRef = useRef<Thread | null>(null);
  threadRef.current = thread;
  const flipRef = useFlipReorder(posts.map((post) => post.id));

  function load() {
    setFlagTarget(null);
    setHiddenAfterFlag(false);
    setHiddenPostIds([]);
    setLoadState("loading");
    if (printerPreview) {
      setThread(null);
      setPosts([]);
      setCommunity(null);
      setLoadState("ready");
      return;
    }
    void getThread(id).then((result) => {
      if (!result) {
        setLoadState("error");
        return;
      }
      setThread(result.thread);
      // Spread: ThreadDetailDto.posts is readonly in generated schema; useState holds a mutable array.
      setPosts([...result.posts]);
      setLoadState("ready");
      void getCommunity(result.thread.community_id).then((communityResult) => setCommunity(communityResult));
    });
  }

  useEffect(load, [id, printerPreview]);

  function reload() {
    void getThread(id).then((result) => {
      if (!result) return;
      setThread(result.thread);
      // Spread: same readonly → mutable fix as in load().
      setPosts([...result.posts]);
    });
  }

  function handleThreadVoted(result: VoteResult) {
    setThread((prev) => (prev ? { ...prev, votes_up: result.votes_up, votes_down: result.votes_down } : prev));
  }

  function handlePostVoted(postId: string, result: VoteResult) {
    setPosts((prev) => prev.map((post) => (post.id === postId ? { ...post, votes_up: result.votes_up, votes_down: result.votes_down } : post)));
  }

  async function handleAccept(postId: string) {
    const current = threadRef.current;
    if (!current) return;
    const rollback = current.accepted_post_id;
    setThread((prev) => (prev ? { ...prev, accepted_post_id: postId } : prev));
    const result = await acceptPost(current.id, postId);
    if (!result) {
      setThread((prev) => (prev ? { ...prev, accepted_post_id: rollback } : prev));
      overlay.toast({ severity: "warn", title: "Не удалось. Попробуйте ещё" });
      return;
    }
    // Сервер — источник истины порядка (§3.5): перезапрашиваем тред целиком, посты уже придут
    // пересортированными (accepted → голоса → время).
    reload();
  }

  async function handlePostCreated(post: Post) {
    setPosts((prev) => [...prev, post]);
    setReplyTarget(null);
    reload();
  }

  const communitySlug = community?.slug ?? null;

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          onSectionChange={onSectionChange}
          onBack={() => navigate(communitySlug ? communityPath(communitySlug) : communitiesPath())}
        />
      </div>
      <main className="homeContent cmtyContent">
        {loadState === "loading" ? <ThreadDetailSkeleton /> : null}

        {loadState === "error" ? (
          <EmptyState
            icon={<ThreadIcon />}
            title="Тред не найден"
            sub="Возможно, он был удалён, либо не удалось загрузить — попробуйте ещё раз."
            action={
              <Button variant="ghost" icon={null} type="button" className="modelGlassBtn pressable" onClick={load}>
                Повторить
              </Button>
            }
          />
        ) : null}

        {loadState === "ready" && printerPreview ? <PrinterPreviewThread preview={printerPreview} /> : null}

        {loadState === "ready" && thread ? (
          hiddenAfterFlag ? (
            <HiddenThread onBack={() => navigate(communitySlug ? communityPath(communitySlug) : communitiesPath())} />
          ) : (
          <>
            <article className="cmtyThreadArticle">
              <div className="cmtyThreadEyebrowRow">
                <Eyebrow>
                  {community ? (
                    <Button variant="ghost" icon={null} type="button" className="cmtyEyebrowLink pressable" onClick={() => navigate(communityPath(community.slug))}>
                      {community.name}
                    </Button>
                  ) : (
                    "…"
                  )}
                  {" · "}
                  {authorDisplayName(thread.author_id, user)}
                  {" · "}
                  {relativeDate(thread.created_at)}
                </Eyebrow>
                <ThreadTypeBadge type={thread.type} solved={thread.type === "question" && thread.accepted_post_id !== null} />
              </div>

              <Heading size="md">{thread.title}</Heading>

              {thread.type === "question" && thread.tags.length > 0 ? (
                <div className="cmtyThreadCardTags">
                  {thread.tags.map((tag) => (
                    <span key={tag} className="cmtyTag">
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="cmtyThreadBody">
                <MarkdownBody source={thread.content} />
              </div>

              <div className="cmtyThreadVoteRow">
                <VoteArrows
                  user={user}
                  subjectType="thread"
                  subjectId={thread.id}
                  votesUp={thread.votes_up}
                  votesDown={thread.votes_down}
                  myVote={0}
                  variant="large"
                  onVoted={handleThreadVoted}
                />
                <Button variant="ghost" icon={null} type="button" className="cmtyPostActionBtn pressable cmtyFlagBtn" onClick={() => setFlagTarget({ type: "thread", id: thread.id })}>
                  Пожаловаться
                </Button>
              </div>
            </article>

            <div className="cmtyPostsSection">
              <Eyebrow>{formatPostCount(posts.length)}</Eyebrow>

              {thread.status === "open" ? (
                <PostComposer
                  threadType={thread.type}
                  threadId={thread.id}
                  replyTarget={replyTarget}
                  onCancelReply={() => setReplyTarget(null)}
                  onCreated={handlePostCreated}
                />
              ) : (
                <div className="cmtyThreadClosed">Тред закрыт для новых ответов</div>
              )}

              {posts.length === 0 ? (
                <EmptyState
                  icon={<ThreadIcon />}
                  title={thread.type === "question" ? "Пока нет ответов на вопрос" : "Пока нет ответов. Будьте первым"}
                />
              ) : (
                <div className="cmtyPostList" ref={flipRef as unknown as React.RefObject<HTMLDivElement>}>
                  {posts.map((post) => (
                    hiddenPostIds.includes(post.id) ? (
                      <HiddenPost key={post.id} />
                    ) : (
                      <PostCard
                        key={post.id}
                        post={post}
                        thread={thread}
                        user={user}
                        flipRef={flipRef(post.id)}
                        onVoted={handlePostVoted}
                        onAccept={() => void handleAccept(post.id)}
                        onReply={() => setReplyTarget({ postId: post.id, authorLabel: authorDisplayName(post.author_id, user) })}
                        onFlag={() => setFlagTarget({ type: "post", id: post.id })}
                      />
                    )
                  ))}
                </div>
              )}
            </div>
          </>
          )
        ) : null}
      </main>
      {flagTarget && thread ? (
        <FlagDialog
          target={flagTarget}
          onClose={() => setFlagTarget(null)}
          onHidden={() => {
            if (flagTarget.type === "thread") setHiddenAfterFlag(true);
            else setHiddenPostIds((previous) => [...previous, flagTarget.id]);
            setFlagTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PrinterPreviewThread({ preview }: { preview: NonNullable<ReturnType<typeof printerCommunityPreviewById>> }) {
  return (
    <article className="cmtyThreadPreview" aria-label="Превью обсуждения принтера">
      <Eyebrow>ОБСУЖДЕНИЕ ПРИНТЕРА · ПРЕВЬЮ</Eyebrow>
      <Heading size="md">{preview.title}</Heading>
      <p className="cmtyThreadPreviewMeta">{preview.author} · {preview.age}</p>
      <p className="cmtyThreadPreviewBody">{preview.body}</p>
    </article>
  );
}

function HiddenThread({ onBack }: { onBack: () => void }) {
  return (
    <EmptyState
      icon={<ThreadIcon />}
      title="Материал временно скрыт на время проверки"
      sub="Он недоступен в общей ленте и поиске, пока модератор не примет решение."
      action={<Button variant="ghost" icon={null} type="button" className="modelGlassBtn pressable" onClick={onBack}>Назад к обсуждениям</Button>}
    />
  );
}

function HiddenPost() {
  return (
    <div className="cmtyHiddenPost" role="status">
      <strong>Материал временно скрыт на время проверки</strong>
      <span>Он недоступен в общей ленте и поиске, пока модератор не примет решение.</span>
    </div>
  );
}

function PostComposer({
  threadType,
  threadId,
  replyTarget,
  onCancelReply,
  onCreated,
}: {
  threadType: Thread["type"];
  threadId: string;
  replyTarget: { postId: string; authorLabel: string } | null;
  onCancelReply: () => void;
  onCreated: (post: Post) => void;
}) {
  const sound = useInteractionSound();
  const defaultKind: PostKind = threadType === "question" ? "answer" : "reply";
  const [asComment, setAsComment] = useState(false);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // parent_post_id (реплай на конкретный пост) не завязан на kind (§3.4/§3.5: «тот же композер» —
  // переключатель «комментарий вместо ответа» работает одинаково, реплай ли это или нет).
  const kind: PostKind = asComment ? "comment" : defaultKind;
  const placeholder = kind === "comment" ? "Ваш комментарий…" : "Ваш ответ…";
  const contentValid = content.trim().length > 0 && content.length <= POST_CONTENT_MAX_LENGTH;

  async function submit() {
    if (!contentValid || sending) return;
    setSending(true);
    setError(null);
    try {
      const post = await createPost(threadId, {
        kind,
        content,
        parent_post_id: replyTarget?.postId,
      });
      sound.cta();
      setContent("");
      onCreated(post);
    } catch (err) {
      setError(communityErrorMessage(err instanceof CommunityApiError ? err.code : "unknown"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="cmtyComposer">
      {replyTarget ? (
        <div className="cmtyComposerReplyLabel">
          Ответ для {replyTarget.authorLabel}
          <Button variant="ghost" icon={null} type="button" aria-label="Отменить ответ" onClick={onCancelReply}>
            ✕
          </Button>
        </div>
      ) : null}
      <MarkdownEditor
        id="cmtyPostComposer"
        value={content}
        onChange={setContent}
        placeholder={placeholder}
        fieldLabel="Ответ"
        imageDisabledHint="Картинки в постах сообщества скоро появятся (MF-744)"
      />
      {content.length > POST_CONTENT_MAX_LENGTH ? (
        <div className="marketFieldError">Текст — до {POST_CONTENT_MAX_LENGTH.toLocaleString("ru-RU")} символов</div>
      ) : null}
      {error ? <div className="marketFieldError">{error}</div> : null}
      <div className="cmtyComposerActions">
        {!replyTarget ? (
          <Button variant="ghost" icon={null}
            type="button"
            className="cmtyComposerSwitch pressable"
            onClick={() => {
              sound.tick();
              setAsComment((prev) => !prev);
            }}
          >
            {asComment ? "Оставить ответ вместо комментария" : "Оставить комментарий вместо ответа"}
          </Button>
        ) : (
          <span />
        )}
        <Button variant="ghost" icon={null} type="button" className="modelGlassBtn pressable" disabled={!contentValid} loading={sending} onClick={() => void submit()}>
          {sending ? "Отправляю…" : "Отправить"}
        </Button>
      </div>
    </div>
  );
}

function PostCard({
  post,
  thread,
  user,
  flipRef,
  onVoted,
  onAccept,
  onReply,
  onFlag,
}: {
  post: Post;
  thread: Thread;
  user: SessionUser;
  flipRef: (node: HTMLElement | null) => void;
  onVoted: (postId: string, result: VoteResult) => void;
  onAccept: () => void;
  onReply: () => void;
  onFlag: () => void;
}) {
  const canAccept = user.id === thread.author_id && post.kind === "answer" && thread.type === "question";
  const acceptLabel = thread.accepted_post_id && thread.accepted_post_id !== post.id ? "Сделать принятым вместо текущего" : "Отметить принятым";

  return (
    <div ref={flipRef} className="cmtyPostCard" data-nested={post.parent_post_id ? "true" : undefined}>
      <div className="cmtyPostCardHead">
        {post.is_accepted ? <span className="cmtyAcceptedBadge">✓ Принято</span> : null}
        <span className="cmtyPostAuthor">{authorDisplayName(post.author_id, user)}</span>
        <span className="cmtyPostTime">{relativeDate(post.created_at)}</span>
      </div>
      <div className="cmtyPostBody">
        <MarkdownBody source={post.content} />
      </div>
      <div className="cmtyPostCardFooter">
        <VoteArrows
          user={user}
          subjectType="post"
          subjectId={post.id}
          votesUp={post.votes_up}
          votesDown={post.votes_down}
          myVote={0}
          onVoted={(result) => onVoted(post.id, result)}
        />
        <div className="cmtyPostCardActions">
          <Button variant="ghost" icon={null} type="button" className="cmtyPostActionBtn pressable" onClick={onReply}>
            Ответить
          </Button>
          <Button variant="ghost" icon={null} type="button" className="cmtyPostActionBtn pressable" onClick={onFlag}>
            Пожаловаться
          </Button>
          {canAccept ? (
            <Button variant="ghost" icon={null} type="button" className="cmtyPostActionBtn pressable" onClick={onAccept}>
              {acceptLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ThreadDetailSkeleton() {
  return (
    <div className="cmtySkeletonGrid" aria-hidden="true" style={{ gridTemplateColumns: "1fr" }}>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="cmtySkeletonTile">
          <div className="cmtySkeletonLine" style={{ width: "40%" }} />
          <div className="cmtySkeletonLine" style={{ width: "90%" }} />
          <div className="cmtySkeletonLine" style={{ width: "70%" }} />
        </div>
      ))}
    </div>
  );
}

function ThreadIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.5h16v10H9l-4 3.5v-3.5H4v-10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}