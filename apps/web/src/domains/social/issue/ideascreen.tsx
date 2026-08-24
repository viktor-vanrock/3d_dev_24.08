import { useEffect, type ReactNode, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, разрядка отложена до pages/DI (Этап 10). Cм. MIGRATION.md.
import "@pages/home/home.css";
import { relativeDate } from "@shared/lib";
import { MarkdownBody, AuroraBackground, AgentBadge, EmptyState, Eyebrow, Heading, StatusPill, Vote, ReasonPanel } from "@shared/ui";
// eslint-disable-next-line boundaries/element-types -- легатное межданное ребро (микроэтап 7.6): рантайм-зависимость, не тип/utility; разрядка отложена до pages/DI-этапа. Cм. apps/web/MIGRATION.md.
import { ProblemTag, MarkdownEditor } from "@domains/commerce";
import { issuePath, navigate } from "../../../router.ts";
import "./issue.css";
import {
  getIdea,
  IDEA_COMMENT_MAX_LENGTH,
  IdeaApiError,
  ideaCategoryLabel,
  ideaStatusMeta,
  listIdeaComments,
  postIdeaComment,
  toggleIdeaVote,
  type IdeaComment,
  type IdeaDetail,
} from "./api.ts";

// Страница идеи `/issue/:id` (docs/design/ideas.md §3, §7, §8, MF-946). Стейдж 2 подзадача
// MF-562, использует голосовалку/блок причины из MF-943 напрямую. Light-режим шапки —
// как страница проекта/трид форума (headerModeFor в router.ts уже отдаёт "light" по умолчанию для
// неперечисленных экранов, отдельного case не требуется).

type LoadState = "loading" | "ready" | "error";

// Автор идеи/комментария сегодня отдаётся только `user_id` (uuid), без username (проверено
// против apps/api/src/ideas/{detail,comments}.ts) — тот же контрактный разрыв, что уже принят в
// community/api.ts::authorDisplayName: для себя показываем "@ник" из сессии, для остальных —
// нейтральную подпись (ссылка на профиль появится, когда API станет отдавать username).
function authorDisplayName(authorId: string, viewer: SessionUser | null): string {
  if (viewer && authorId === viewer.id) return `@${viewer.username}`;
  return "Участник";
}

export function IdeaScreen({
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
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [comments, setComments] = useState<IdeaComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [threadError, setThreadError] = useState(false);

  function load() {
    setLoadState("loading");
    void getIdea(id).then((result) => {
      if (!result) {
        setLoadState("error");
        return;
      }
      setIdea(result);
      // Spread: IdeaDetailDto.comments is readonly in generated schema; useState holds a mutable array.
      setComments([...result.comments]);
      setLoadState("ready");
      // Первый экран уже пришёл инлайн (§3.5 стык-3) — курьет старых нужен только если ровно
      // FIRST_COMMENTS_PAGE (20) пришло, иначе кроме них ничего нет (API не отдаёт next_cursor
      // отдельно для инлайн-пейлоада — считаем достаточным, если пришло меньше страницы).
      setNextCursor(result.comments.length >= 20 ? result.comments[result.comments.length - 1]?.created_at ?? null : null);
    });
  }

  useEffect(load, [id]);

  async function loadEarlier() {
    if (!nextCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    setThreadError(false);
    const page = await listIdeaComments(id, nextCursor);
    setLoadingEarlier(false);
    if (!page) {
      setThreadError(true);
      return;
    }
    // apps/api/src/ideas/comments.ts::GET .../comments пагинирует ВПЕРЁД (`created_at > cursor`,
    // asc): первая страница (инлайн в GET /ideas/:id) — уже самые старые N; курсор догружает
    // СЛЕДУЮЩИЕ по хронологии (более новые из хвоста), не более ранние. Поэтому — дозагрузка
    // снизу, а не «показать раньше» сверху (спека §3.5 описывает противоположный сценарий,
    // который сегодняшний API не поддерживает — см. итоговый комментарий карточки).
    setComments((prev) => [...prev, ...page.items]);
    setNextCursor(page.next_cursor);
  }

  async function handleVoteToggle(): Promise<boolean> {
    const result = await toggleIdeaVote(id);
    if (!result) return false;
    setIdea((prev) => (prev ? { ...prev, vote_count: result.vote_count, viewer_has_voted: result.viewer_has_voted } : prev));
    return true;
  }

  if (loadState === "loading") {
    return (
      <IdeaShell user={user} section={section} onSectionChange={onSectionChange}>
        <IdeaDetailSkeleton />
      </IdeaShell>
    );
  }

  if (loadState === "error" || !idea) {
    return (
      <IdeaShell user={user} section={section} onSectionChange={onSectionChange}>
        <EmptyState
          icon={<IdeaIcon />}
          title="Идея не найдена"
          sub="Возможно, она была удалена, либо не удалось загрузить — попробуйте ещё раз."
          action={
            <button type="button" className="modelGlassBtn pressable" onClick={load}>
              Повторить
            </button>
          }
        />
      </IdeaShell>
    );
  }

  const meta = ideaStatusMeta(idea.status);
  const isAuthor = idea.author_id === user.id;
  const voteReason: "own" | undefined = isAuthor ? "own" : undefined;
  // Проблема не голосуется (docs/design/feedback.entrypoints.md §4.2, «голосовать тут нечего») —
  // нейтральная ProblemTag вместо статус-пилюли, голосовалка скрыта целиком.
  const isProblem = idea.type === "problem";

  return (
    <IdeaShell user={user} section={section} onSectionChange={onSectionChange}>
      <div className="issueEyebrowRow">
        <Eyebrow>
          {ideaCategoryLabel(idea.category)} · предложил {authorDisplayName(idea.author_id, user)} · {relativeDate(idea.created_at)}
        </Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {idea.assignee_type === "agent" ? <AgentBadge /> : null}
          {isProblem ? (
            <ProblemTag />
          ) : (
            <StatusPill tone={meta.tone} level={meta.level} done={meta.done}>
              {meta.label}
            </StatusPill>
          )}
        </div>
      </div>

      <Heading size="md">{idea.title}</Heading>

      {idea.status === "declined" || idea.status === "duplicate" ? (
        <div className="issueReasonWrap">
          <ReasonPanel
            tone={idea.status === "declined" ? "danger" : "dim"}
            title={idea.status === "declined" ? "Отклонена" : "Дубликат идеи"}
            reason={idea.decline_reason}
            canonicalHref={idea.status === "duplicate" && idea.canonical_id ? issuePath(idea.canonical_id) : undefined}
            canonicalLabel="Смотреть оригинал"
          />
        </div>
      ) : null}

      <div className="issueBody">
        <MarkdownBody source={idea.body} />
      </div>

      {isProblem ? null : (
        <div className="issueVoteRow">
          <Vote variant="large" voteCount={idea.vote_count} hasVoted={idea.viewer_has_voted} reason={voteReason} onToggle={handleVoteToggle} />
        </div>
      )}

      <div className="issueDiscussionSection">
        <Eyebrow>Обсуждение · {comments.length}</Eyebrow>

        <Composer ideaId={idea.id} onCreated={(comment) => setComments((prev) => [...prev, comment])} />

        {threadError ? <div className="marketFieldError">Не удалось загрузить обсуждение · Повторить</div> : null}

        {comments.length === 0 ? (
          <EmptyState icon={<IdeaIcon />} title="Пока нет обсуждения. Будьте первым" />
        ) : (
          <div className="issueCommentList">
            {comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} user={user} />
            ))}
          </div>
        )}

        {nextCursor ? (
          <button type="button" className="modelGlassBtn pressable issueLoadEarlier" disabled={loadingEarlier} onClick={() => void loadEarlier()}>
            {loadingEarlier ? "Загружаю…" : "Показать ещё"}
          </button>
        ) : null}
      </div>
    </IdeaShell>
  );
}

function IdeaShell({
  user,
  section,
  onSectionChange,
  children,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  children: ReactNode;
}) {
  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} onBack={() => navigate("/issue", "back")} />
      </div>
      <main className="homeContent">{children}</main>
    </div>
  );
}

function Composer({ ideaId, onCreated }: { ideaId: string; onCreated: (comment: IdeaComment) => void }) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contentValid = content.trim().length > 0 && content.length <= IDEA_COMMENT_MAX_LENGTH;

  async function submit() {
    if (!contentValid || sending) return;
    setSending(true);
    setError(null);
    try {
      const comment = await postIdeaComment(ideaId, content);
      setContent("");
      onCreated(comment);
    } catch (err) {
      setError(err instanceof IdeaApiError ? "Не удалось отправить. Попробуйте ещё" : "Не удалось отправить. Попробуйте ещё");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="issueComposer">
      <MarkdownEditor
        id="issueCommentComposer"
        value={content}
        onChange={setContent}
        placeholder="Ваш комментарий…"
        fieldLabel="Комментарий"
        imageDisabledHint="Картинки в комментариях идей не поддерживаются"
      />
      {content.length > IDEA_COMMENT_MAX_LENGTH ? (
        <div className="marketFieldError">Текст — до {IDEA_COMMENT_MAX_LENGTH.toLocaleString("ru-RU")} символов</div>
      ) : null}
      {error ? <div className="marketFieldError">{error}</div> : null}
      <div className="issueComposerActions">
        <button type="button" className="modelGlassBtn pressable" disabled={!contentValid || sending} onClick={() => void submit()}>
          {sending ? "Отправляю…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}

function CommentCard({ comment, user }: { comment: IdeaComment; user: SessionUser }) {
  return (
    <div className="issueCommentCard">
      <div className="issueCommentHead">
        <div className="issueCommentMeta">
          <span className="issueCommentAuthor">{authorDisplayName(comment.user_id, user)}</span>
          <span>{relativeDate(comment.created_at)}</span>
        </div>
      </div>
      <MarkdownBody source={comment.body} />
    </div>
  );
}

function IdeaDetailSkeleton() {
  return (
    <div className="issueSkeletonGrid" aria-hidden="true">
      <div className="issueSkeletonLine" style={{ width: "40%" }} />
      <div className="issueSkeletonLine" style={{ width: "70%", height: 28 }} />
      <div className="issueSkeletonLine" style={{ width: "95%" }} />
      <div className="issueSkeletonLine" style={{ width: "85%" }} />
      <div className="issueSkeletonLine" style={{ width: "60%" }} />
    </div>
  );
}

function IdeaIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5c-3.6 0-6.5 2.9-6.5 6.5 0 2.3 1.2 4.1 3 5.3.6.4.9 1 .9 1.7v.5h5.2v-.5c0-.7.3-1.3.9-1.7 1.8-1.2 3-3 3-5.3 0-3.6-2.9-6.5-6.5-6.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9.6 19.5h4.8M10.2 21.5h3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}