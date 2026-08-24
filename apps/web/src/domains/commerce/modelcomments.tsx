// Обсуждение модели (docs/design/model.card.visual.md §3, UX — v3 §4): переиспользую формулу
// карточки комментария из feed.post.editor.md §1.6, адаптированную под три отличия v3 —
// один уровень ответов (не дерево), без голосов, «⋯»-меню вместо открытых кнопок. Роут на
// уже разрешённой полиморфной `comments` ещё не задеплоен Back'ом (см. GAP-API в models.ts) —
// до тех пор компонент честно показывает состояние «ошибка» (§3.4), а не тихо ломается.
import { useEffect, useRef, useState } from "react";
import type { GuestIntent } from "@shared/types";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
import { useOverlay } from "@platform/overlay";
import { modelPath, navigate, profilePath } from "../../router.ts";
import { AgentBadge, Eyebrow, EmptyState, Popover, PopoverItem } from "@shared/ui";
import { ContextFeedbackMenuItem } from "./contextfeedback.tsx";
import { relativeDate } from "./market.tsx";
import {
  deleteModelComment,
  getModelComments,
  postModelComment,
  type ModelComment,
} from "./models.ts";
import "./modelcomments.css";

const COMMENT_MAX_LENGTH = 2000;

interface CommentThread {
  root: ModelComment;
  replies: ModelComment[];
}

// Один уровень (v3 §4): группируем ответы под их непосредственным корнем, не строим дерево —
// «Ответить» в этом UI никогда не открывается у самого ответа, так что parent_id ответа всегда
// указывает на корневой комментарий.
function buildThreads(items: ModelComment[]): CommentThread[] {
  const roots: ModelComment[] = [];
  const repliesByParent = new Map<string, ModelComment[]>();
  for (const item of items) {
    if (!item.parent_id) {
      roots.push(item);
      continue;
    }
    const list = repliesByParent.get(item.parent_id);
    if (list) list.push(item);
    else repliesByParent.set(item.parent_id, [item]);
  }
  const sortedRoots = [...roots].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sortedRoots.map((root) => ({
    root,
    replies: (repliesByParent.get(root.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}

type LoadState = "loading" | "ready" | "error";

export function ModelComments({
  modelId,
  currentUserId,
  ownerId,
  onGuestComment,
}: {
  modelId: string;
  // Гость читает обсуждение без входа (model.card.v3.md §4.4) — null просто никогда не
  // совпадает с ownerId/author.id ниже, «мои»/«владелец» гостю не подсвечиваются.
  currentUserId: string | null;
  ownerId: string;
  onGuestComment: (intent?: GuestIntent) => void;
}) {
  const overlay = useOverlay();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [items, setItems] = useState<ModelComment[]>([]);
  const isOwner = currentUserId === ownerId;

  function load() {
    setLoadState("loading");
    void getModelComments(modelId).then((result) => {
      if (!result) {
        setLoadState("error");
        return;
      }
      setItems(result.items);
      setLoadState("ready");
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перезагрузка только по смене модели
  }, [modelId]);

  function handlePosted(comment: ModelComment) {
    setItems((prev) => [comment, ...prev]);
  }

  async function handleDelete(comment: ModelComment) {
    const mine = comment.author.id === currentUserId;
    const confirmed = await overlay.confirm({
      severity: "critical",
      title: "Удалить комментарий?",
      message: mine ? "Комментарий исчезнет, ответы под ним останутся видны." : "Вы удаляете чужой комментарий как владелец проекта.",
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await deleteModelComment(modelId, comment.id);
    if (!ok) {
      overlay.toast({ severity: "critical", title: "Не удалось удалить комментарий" });
      return;
    }
    setItems((prev) =>
      prev.map((c) => (c.id === comment.id ? { ...c, deleted_at: new Date().toISOString(), deleted_by_owner: !mine } : c)),
    );
  }

  const threads = buildThreads(items);

  return (
    <div className="modelComments">
      <Eyebrow>Обсуждение{loadState === "ready" ? ` (${items.length})` : ""}</Eyebrow>

      <CommentComposer
        modelId={modelId}
        isGuest={currentUserId === null}
        onGuestComment={onGuestComment}
        onPosted={handlePosted}
        onError={() => overlay.toast({ severity: "critical", title: "Не удалось отправить комментарий" })}
      />

      {loadState === "loading" ? <CommentsSkeleton /> : null}

      {loadState === "error" ? (
        <div className="modelCommentsError">
          <span>Не удалось загрузить обсуждение</span>
          <button type="button" className="modelGlassBtn pressable" onClick={load}>
            Повторить
          </button>
        </div>
      ) : null}

      {loadState === "ready" && threads.length === 0 ? (
        <EmptyState icon={<CommentIcon />} title="Пока никто не обсуждал" sub="Спросите автора или расскажите, как печаталось" />
      ) : null}

      {loadState === "ready" && threads.length > 0 ? (
        <ul className="modelCommentList">
          {threads.map((thread) => (
            <CommentThreadRow
              key={thread.root.id}
              thread={thread}
              modelId={modelId}
              currentUserId={currentUserId}
              ownerId={ownerId}
              isOwner={isOwner}
              onGuestComment={onGuestComment}
              onPosted={handlePosted}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CommentsSkeleton() {
  return (
    <div className="modelCommentSkeletonList" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className="modelCommentSkeleton" key={i} />
      ))}
    </div>
  );
}

function CommentComposer({
  modelId,
  parentId,
  autoFocus,
  isGuest,
  onGuestComment,
  onPosted,
  onError,
  onCancel,
}: {
  modelId: string;
  parentId?: string;
  autoFocus?: boolean;
  isGuest: boolean;
  onGuestComment: (intent?: GuestIntent) => void;
  onPosted: (comment: ModelComment) => void;
  onError: () => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  async function submit() {
    const body = value.trim();
    if (!body || sending) return;
    // Гость жмёт «Отправить» → промпт входа поверх (model.card.v3.md §4.4): комментарий
    // уходит сам после логина (guestintent.ts/guestresume.tsx), текст не теряется.
    if (isGuest) {
      onGuestComment({ kind: "comment_model", modelId, parentId, body, returnTo: modelPath(modelId) });
      return;
    }
    setSending(true);
    const comment = await postModelComment(modelId, body, parentId);
    setSending(false);
    if (!comment) {
      // Текст не теряется при ошибке (v3 §4.5) — не очищаем value.
      onError();
      return;
    }
    setValue("");
    onPosted(comment);
    onCancel?.();
  }

  return (
    <div className="modelCommentComposer">
      <textarea
        ref={textareaRef}
        className="marketTextarea"
        placeholder="Оставьте комментарий…"
        maxLength={COMMENT_MAX_LENGTH}
        rows={parentId ? 2 : 3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="modelCommentComposerActions">
        {onCancel ? (
          <button type="button" className="modelGlassBtn pressable" onClick={onCancel}>
            Отмена
          </button>
        ) : null}
        <button
          type="button"
          className="modelGlassBtn pressable"
          disabled={!value.trim() || sending}
          onClick={() => void submit()}
        >
          {sending ? "Отправляю…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}

function CommentThreadRow({
  thread,
  modelId,
  currentUserId,
  ownerId,
  isOwner,
  onGuestComment,
  onPosted,
  onDelete,
}: {
  thread: CommentThread;
  modelId: string;
  currentUserId: string | null;
  ownerId: string;
  isOwner: boolean;
  onGuestComment: (intent?: GuestIntent) => void;
  onPosted: (comment: ModelComment) => void;
  onDelete: (comment: ModelComment) => void;
}) {
  const [replying, setReplying] = useState(false);

  return (
    <li className="modelCommentThread">
      <CommentRow
        comment={thread.root}
        currentUserId={currentUserId}
        ownerId={ownerId}
        isOwner={isOwner}
        canReply
        onReply={() => setReplying((prev) => !prev)}
        onDelete={onDelete}
      />
      {replying ? (
        <div className="modelCommentReplyComposer">
          <CommentComposer
            modelId={modelId}
            parentId={thread.root.id}
            autoFocus
            isGuest={currentUserId === null}
            onGuestComment={onGuestComment}
            onPosted={(comment) => {
              onPosted(comment);
              setReplying(false);
            }}
            onError={() => {}}
            onCancel={() => setReplying(false)}
          />
        </div>
      ) : null}
      {thread.replies.length > 0 ? (
        <ul className="modelCommentReplyList">
          {thread.replies.map((reply) => (
            <li key={reply.id} className="modelCommentReplyItem">
              <CommentRow
                comment={reply}
                currentUserId={currentUserId}
                ownerId={ownerId}
                isOwner={isOwner}
                canReply={false}
                onDelete={onDelete}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CommentRow({
  comment,
  currentUserId,
  ownerId,
  isOwner,
  canReply,
  onReply,
  onDelete,
}: {
  comment: ModelComment;
  currentUserId: string | null;
  ownerId: string;
  isOwner: boolean;
  canReply: boolean;
  onReply?: () => void;
  onDelete: (comment: ModelComment) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mine = comment.author.id === currentUserId;
  const isAuthorOwner = comment.author.id === ownerId;
  const canDelete = mine || isOwner;

  // Клик мимо «⋯»-меню закрывает его (тот же приём, что homeheader.tsx::HomeHeader — homePopover).
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  if (comment.deleted_at) {
    return (
      <div className="modelCommentRow modelCommentRow--deleted">
        <span className="modelCommentDeletedLabel">
          {comment.deleted_by_owner ? "Комментарий удалён владельцем проекта" : "Комментарий удалён"}
        </span>
      </div>
    );
  }

  return (
    <div className="modelCommentRow" data-mine={mine || undefined}>
      {comment.author.avatar_config ? (
        <AvatarBubble
          config={comment.author.avatar_config}
          snapshots={comment.author.avatar_snapshots ?? null}
          size={32}
          facing="front"
        />
      ) : (
        <AvatarBubble
          config={deterministicAvatarConfig(comment.author.username || comment.author.id)}
          snapshots={null}
          size={32}
          facing="front"
        />
      )}
      <div className="modelCommentBody">
        <div className="modelCommentHead">
          <button type="button" className="modelCommentAuthor pressable" onClick={() => navigate(profilePath(comment.author.username))}>
            @{comment.author.username}
          </button>
          {isAuthorOwner ? <AgentBadge>автор</AgentBadge> : null}
          <span className="modelCommentTime" title={new Date(comment.created_at).toLocaleString("ru-RU")}>
            {relativeDate(comment.created_at)}
          </span>
        </div>
        <p className="modelCommentText">{comment.body}</p>
        <div className="modelCommentActions">
          {canReply ? (
            <button type="button" className="modelCommentActionBtn pressable" onClick={onReply}>
              Ответить
            </button>
          ) : null}
        </div>
      </div>
      <div className="modelCommentMenu" ref={menuRef}>
        <button
          type="button"
          className="modelCommentMenuTrigger pressable"
          aria-label="Ещё"
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <DotsIcon />
        </button>
        {menuOpen ? (
          <Popover align="end">
            {canDelete ? (
              <PopoverItem
                danger
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(comment);
                }}
              >
                Удалить
              </PopoverItem>
            ) : null}
            <ContextFeedbackMenuItem
              context={{ category: "comment", ref: { type: "comment", id: comment.id } }}
              onNavigate={() => setMenuOpen(false)}
            />
          </Popover>
        ) : null}
      </div>
    </div>
  );
}

function CommentIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.5h16v10H9l-4 3.5v-3.5H4v-10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}
