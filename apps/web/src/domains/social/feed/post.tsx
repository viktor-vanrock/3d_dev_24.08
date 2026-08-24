import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@shared/types";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { HomeHeader, type Section } from "@platform/nav";
import { relativeDate } from "@shared/lib";
import { apiAssetUrl } from "@shared/api";
import { modelPath, feedPath, headerModeFor, navigate, profilePath, communityPath } from "../../../router.ts";
import { useOverlay } from "@platform/overlay";
import { AuroraBackground, EmptyState, Eyebrow, Heading, LetterboxImage } from "@shared/ui";
import {
  createFeedComment,
  deleteFeedPost,
  getFeedPost,
  listAuthorFeed,
  listCommunityFeed,
  listFeedComments,
  updateFeedPost,
  uploadFeedPostImage,
  FEED_ORIGIN_KEY,
  type FeedComment,
  type FeedAgentRef,
  type FeedAuthorRef,
  type FeedCommunityRef,
  type FeedPost,
} from "./api.ts";
import { CommentComposer, CommentTree } from "./commenttree.tsx";
import { FeedBlockEditor } from "./blockeditor.tsx";
import "./feed.css";
import { GitverseCardBody } from "./postcard.tsx";
import { FeedRichBody } from "./richbody.tsx";
import { FeedProvenance } from "./provenance.tsx";
import { VoteArrows } from "./vote.tsx";

// Страница поста /feed/p/:id (docs/design/feed.post.editor.md §1). headerMode:'light', та же
// логика, что /project/:id (model.tsx) — не wide-листинг, "парящая" деталь-страница.

// Маркер "пришёл из ленты" (§1.1: "определение входа — чисто клиентское") — сам ключ живёт в
// api.ts (см. комментарий там), сюда реэкспортирован для обратной совместимости импортов.
export { FEED_ORIGIN_KEY };
const TITLE_EDIT_WINDOW_MS = 15 * 60 * 1000;

export function FeedPostContextCard({
  community,
  author,
  coAuthor,
  related = [],
}: {
  community?: FeedCommunityRef | null;
  author?: FeedAuthorRef | null;
  coAuthor?: FeedAgentRef | null;
  related?: FeedPost[];
}) {
  if (!community && !author) return null;
  const official = community?.kind === "vendor" || community?.kind === "machine";
  return (
    <aside className="feedPostContextCard" aria-label="Контекст публикации">
      {author ? (
        <button type="button" className="feedPostContextAuthor pressable" onClick={() => navigate(profilePath(author.username))}>
          <AvatarBubble
            config={author.avatar_config ?? deterministicAvatarConfig(author.username || author.id)}
            snapshots={author.avatar_config ? (author.avatar_snapshots ?? null) : null}
            size={68}
            facing="front"
          />
          <span>
            <small>{coAuthor ? "Совместная работа" : "Автор работы"}</small>
            <strong>{author.display_name || author.username}</strong>
            <small>
              @{author.username}
              {coAuthor ? (
                <>
                  {" "}
                  <span className="feedCoAuthorBadge" title={[coAuthor.bio, coAuthor.runtime_label].filter(Boolean).join(" · ") || undefined}>
                    <span aria-hidden="true">🤖</span>
                    {coAuthor.name}
                  </span>
                </>
              ) : null}
            </small>
          </span>
          <span className="feedPostContextArrow" aria-hidden="true">↗</span>
        </button>
      ) : null}
      {community ? (
        <div className="feedPostContextSection">
          <span className="feedPostContextMark">{community.name[0]?.toUpperCase()}</span>
          <div>
            <span className="feedPostContextKicker">Опубликовано в</span>
            <h2>{community.name}</h2>
            {official ? <span className="feedPostOfficialBadge">Официальное сообщество</span> : <span className="feedPostContextMuted">Сообщество</span>}
          </div>
          <button type="button" className="feedPostContextLink pressable" onClick={() => navigate(communityPath(community.slug))}>
            Открыть сообщество <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}
      {related.length > 0 ? (
        <div className="feedPostRelated">
          <div className="feedPostRelatedTitle">
            <Eyebrow>{community ? "Ещё в сообществе" : "Ещё от автора"}</Eyebrow>
            <span>{related.length}</span>
          </div>
          {related.slice(0, 3).map((item) => (
            <button type="button" className="feedPostRelatedRow pressable" key={item.id} onClick={() => navigate(`/feed/p/${item.id}`)}>
              <span>{item.title}</span>
              <small>{item.comments_count} ответов · {item.votes_up - item.votes_down} рейтинг</small>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function CubeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

async function share(url: string, title: string, overlay: ReturnType<typeof useOverlay>) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
    } catch {
      // отказ/отмена системного шита — тихо
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    overlay.toast({ severity: "success", title: "Ссылка скопирована" });
  } catch {
    overlay.toast({ severity: "info", title: "Скопируйте ссылку из адресной строки" });
  }
}

function PostBody({ post }: { post: FeedPost }) {
  if (post.type === "model_link") {
    return (
      <div className="feedPostDetailModel">
        <LetterboxImage
          className="feedPostDetailModelPreview"
          src={post.model?.thumb_url}
          alt={post.model?.title ?? ""}
          style={{ cursor: "pointer" }}
          role="button"
          tabIndex={0}
          onClick={() => post.model_id && navigate(modelPath(post.model_id))}
        />
        <div className="feedPostDetailModelCopy">
          <Eyebrow>3D-модель</Eyebrow>
          <strong>{post.model?.title ?? "Модель удалена"}</strong>
          {post.model ? (
            <div className="feedPostDetailModelStats">
              <span>♥ {post.model.votes_up}</span>
              <span>↓ {post.model.downloads_count} скачиваний</span>
            </div>
          ) : null}
          {post.model_id ? (
            <button type="button" className="modelGlassBtn pressable feedPostDetailModelButton" onClick={() => navigate(modelPath(post.model_id!))}>
              Открыть в 3D <span aria-hidden="true">↗</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (post.type === "media") {
    if (!post.media_url) return <LetterboxImage className="feedPostCardMedia" src={undefined} />;
    // MF-2035: тот же безусловный <video>, что был в postcard.tsx — третье, независимое место
    // с той же багой (детальная страница поста — не карточка и не inline-раскрытие).
    // media_url — API-относительный путь (/feed/posts/:id/media), apiAssetUrl() резолвит на
    // api.dev.3mf.tech — без него браузер резолвил его от текущего (веб-)origin и ловил 404/SPA-
    // шелл вместо байт (тот же класс бага, что apiAssetUrl(thumb) уже чинит для моделей).
    return post.media_kind === "image" ? (
      <LetterboxImage className="feedPostImage" src={apiAssetUrl(post.media_url)} />
    ) : (
      <video className="feedPostVideo" src={apiAssetUrl(post.media_url)} poster={post.poster_url ? apiAssetUrl(post.poster_url) : undefined} controls />
    );
  }
  if (post.type === "gitverse") {
    return <GitverseCardBody url={post.gitverse_url ?? null} repo={post.gitverse ?? null} />;
  }
  return null;
}

function commentCountLabel(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} комментариев`;
  if (mod10 === 1) return `${count} комментарий`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} комментария`;
  return `${count} комментариев`;
}

export function FeedPostScreen({
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
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [more, setMore] = useState<FeedPost[]>([]);
  const [editingBody, setEditingBody] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [deleted, setDeleted] = useState(false);
  const cameFromFeed = useRef(false);

  useEffect(() => {
    cameFromFeed.current = sessionStorage.getItem(FEED_ORIGIN_KEY) === "1";
    sessionStorage.removeItem(FEED_ORIGIN_KEY);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPost(undefined);
    void getFeedPost(id).then((result) => {
      if (!cancelled) setPost(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!post) return;
    let cancelled = false;
    setComments(null);
    void listFeedComments(id).then((page) => {
      if (!cancelled) setComments(page?.items ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [id, post]);

  useEffect(() => {
    // Deep-link из футер-пилюли карточки ленты (feed.md §2.3: "тап → пост, фокус на треде
    // комментариев") — ждём загрузки треда, иначе скроллим к ещё пустому месту в разметке.
    if (comments === null || window.location.hash !== "#comments") return;
    document.getElementById("comments")?.scrollIntoView({ block: "start" });
  }, [comments]);

  useEffect(() => {
    if (!post) return;
    let cancelled = false;
    const loader = post.community_id ? listCommunityFeed(post.community_id, 3) : listAuthorFeed(post.author_id, 3);
    void loader.then((page) => {
      if (!cancelled && page) setMore(page.items.filter((item) => item.id !== post.id));
    });
    return () => {
      cancelled = true;
    };
    // Узкие ключи, не весь `post` — иначе оптимистичный апдейт голоса (новый объект post при том
    // же id) триггерил бы повторную загрузку "ещё из саба" на каждый тап по стрелке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id, post?.community_id, post?.author_id]);

  function handleBack() {
    if (cameFromFeed.current) {
      window.history.back();
      return;
    }
    navigate(feedPath());
  }

  async function handleReply(parentId: string | undefined, body: string): Promise<boolean> {
    const created = await createFeedComment(id, body, parentId);
    if (!created) {
      overlay.toast({ severity: "critical", title: "Не удалось отправить. Попробуйте снова" });
      return false;
    }
    setComments((prev) => [...(prev ?? []), created]);
    setPost((prev) => (prev ? { ...prev, comments_count: prev.comments_count + 1 } : prev));
    return true;
  }

  function handleCommentDeleted(commentId: string) {
    setComments((prev) => (prev ?? []).filter((comment) => comment.id !== commentId));
  }

  async function handleSaveBody() {
    const ok = await updateFeedPost(id, { body: bodyDraft });
    if (!ok) {
      overlay.toast({ severity: "critical", title: "Не удалось сохранить" });
      return;
    }
    setPost((prev) => (prev ? { ...prev, body: bodyDraft, is_edited: true, edited_at: new Date().toISOString() } : prev));
    setEditingBody(false);
  }

  async function handleSaveTitle() {
    const title = titleDraft.trim();
    if (!title) return;
    const ok = await updateFeedPost(id, { title });
    if (!ok) {
      overlay.toast({ severity: "critical", title: "Не удалось сохранить" });
      return;
    }
    setPost((prev) => (prev ? { ...prev, title } : prev));
    setEditingTitle(false);
  }

  async function handleDelete() {
    if (!post) return;
    const confirmed = await overlay.confirm({
      severity: "critical",
      title: "Удалить пост?",
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await deleteFeedPost(post.id);
    if (!ok) {
      overlay.toast({ severity: "critical", title: "Не удалось удалить. Попробуйте ещё раз" });
      return;
    }
    if (post.comments_count > 0) {
      setDeleted(true);
    } else {
      navigate(feedPath());
    }
  }

  const mine = post ? post.author_id === user.id : false;
  const canEditTitle = post ? Date.now() - new Date(post.created_at).getTime() < TITLE_EDIT_WINDOW_MS : false;

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          onSectionChange={onSectionChange}
          mode={headerModeFor("feed-post", { withBack: true })}
          onBack={handleBack}
          backLabel={cameFromFeed.current ? undefined : "В ленту"}
        />
      </div>
      <main className="homeContent homeWorkspaceBody feedPostShell">
        {post === undefined ? (
          <div className="feedPostPage" aria-busy="true">
            <div style={{ height: 18, width: 220, background: "var(--surface)", borderRadius: 8 }} />
            <div style={{ height: 32, width: "80%", background: "var(--surface)", borderRadius: 8 }} />
            <div style={{ height: 160, background: "var(--surface)", borderRadius: 20 }} />
          </div>
        ) : post === null ? (
          <EmptyState
            icon={<CubeIcon />}
            title="Пост не найден или удалён"
            action={
              <button type="button" className="modelGlassBtn pressable" onClick={() => navigate(feedPath())}>
                В ленту
              </button>
            }
          />
        ) : deleted ? (
          <EmptyState icon={<CubeIcon />} title="Пост удалён автором" action={<button type="button" className="modelGlassBtn pressable" onClick={() => navigate(feedPath())}>В ленту</button>} />
        ) : (
          <div className="feedPostLayout">
            <article className="feedPostPage">
            <header className="feedPostArticleHeader">
            <div className="feedPostIdentity">
              {post.author ? (
                <AvatarBubble
                  config={post.author.avatar_config ?? deterministicAvatarConfig(post.author.username || post.author.id)}
                  snapshots={post.author.avatar_config ? post.author.avatar_snapshots : null}
                  size={46}
                  facing="front"
                />
              ) : <span className="feedPostDeletedAvatar" aria-hidden="true">?</span>}
              <div className="feedPostEyebrow">
              {post.community ? (
                <>
                  <button type="button" className="feedPostCardHeaderLink" onClick={() => navigate(communityPath(post.community!.slug))}>
                    {post.community.name}
                  </button>
                  <span>·</span>
                </>
              ) : null}
              {post.author ? (
                <>
                  <button type="button" className="feedPostCardHeaderLink" onClick={() => navigate(profilePath(post.author!.username))}>
                    @{post.author.username}
                  </button>
                </>
              ) : (
                <span>[удалённый пользователь]</span>
              )}
              <span>·</span>
              <span>{relativeDate(post.created_at)}</span>
              {post.is_edited ? <span className="feedPostEyebrowEdited">Изменено</span> : null}
              </div>
            </div>

            {editingTitle ? (
              <div className="feedPostTitleEditor">
                <input className="marketInput" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={120} autoFocus />
                <button type="button" className="modelGlassBtn pressable" onClick={() => void handleSaveTitle()}>
                  Сохранить
                </button>
                <button type="button" className="modelGlassBtn pressable" onClick={() => setEditingTitle(false)}>
                  Отмена
                </button>
              </div>
            ) : (
              <div className="feedPostTitleRow">
                <h1>{post.title}</h1>
                {mine && canEditTitle ? (
                  <button
                    type="button"
                    className="feedCommentReplyBtn pressable"
                    onClick={() => {
                      setTitleDraft(post.title);
                      setEditingTitle(true);
                    }}
                  >
                    Изменить заголовок
                  </button>
                ) : null}
              </div>
            )}
            </header>

            <div className="feedPostBody">
              <PostBody post={post} />
              {editingBody ? (
                <div className="feedPostInlineEditor">
                  <FeedBlockEditor
                    id="feed-post-body"
                    value={bodyDraft}
                    onChange={setBodyDraft}
                    user={user}
                    overlay={overlay}
                    uploadImage={(file) => uploadFeedPostImage(post.id, file)}
                  />
                  <div className="feedPostInlineEditorActions">
                    <button type="button" className="modelGlassBtn pressable" onClick={() => setEditingBody(false)}>
                      Отмена
                    </button>
                    <button type="button" className="modelGlassBtn pressable" onClick={() => void handleSaveBody()}>
                      Сохранить
                    </button>
                  </div>
                </div>
              ) : post.body ? (
                <FeedRichBody source={post.body} />
              ) : null}
              <FeedProvenance post={post} variant="detail" />
            </div>

            <div className="feedPostActions feedPostActionBar">
              <VoteArrows
                user={user}
                subjectType="feed_post"
                subjectId={post.id}
                votesUp={post.votes_up}
                votesDown={post.votes_down}
                myVote={post.my_vote ?? 0}
                variant="large"
                approx={post.score_approx ?? Date.now() - new Date(post.created_at).getTime() < 10 * 60_000}
                onVoted={(result) => setPost((prev) => (prev ? { ...prev, votes_up: result.votes_up, votes_down: result.votes_down, my_vote: result.my_vote } : prev))}
              />
              <button type="button" className="modelGlassBtn pressable" onClick={() => document.getElementById("comments")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <span aria-hidden="true">◯</span> {post.comments_count}
              </button>
              <button type="button" className="modelGlassBtn pressable" onClick={() => void share(window.location.href, post.title, overlay)}>
                <span aria-hidden="true">↗</span> Поделиться
              </button>
              {mine ? (
                <>
                  {!editingBody ? (
                    <button
                      type="button"
                      className="modelGlassBtn pressable"
                      onClick={() => {
                        setBodyDraft(post.body ?? "");
                        setEditingBody(true);
                      }}
                    >
                      Изменить
                    </button>
                  ) : null}
                  <button type="button" className="modelGlassBtn pressable" data-danger onClick={() => void handleDelete()}>
                    Удалить
                  </button>
                </>
              ) : null}
            </div>

            <section className="feedComments" id="comments">
              <div className="feedCommentsHeader">
                <div>
                  <Eyebrow>Обсуждение</Eyebrow>
                  <Heading size="md">{commentCountLabel(post.comments_count)}</Heading>
                </div>
                <span className="feedCommentsSort">Сначала лучшие</span>
              </div>
              <CommentComposer user={user} onSubmit={(body) => handleReply(undefined, body)} />
              {comments === null ? (
                <div style={{ color: "var(--text-dim)" }}>Загрузка обсуждения…</div>
              ) : comments.length === 0 ? (
                <EmptyState icon={<CubeIcon />} title="Пока нет комментариев" sub="Будьте первым" />
              ) : (
                <CommentTree comments={comments} user={user} onReply={(parentId, body) => handleReply(parentId, body)} onDeleted={handleCommentDeleted} />
              )}
            </section>
            </article>
            <FeedPostContextCard community={post.community} author={post.author} coAuthor={post.co_author} related={more} />
          </div>
        )}
      </main>
    </div>
  );
}
