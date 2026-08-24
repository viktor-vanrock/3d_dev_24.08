import { useState } from "react";
import type { SessionUser } from "@shared/types";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
import { relativeDate } from "@shared/lib";
import { MarkdownBody } from "@shared/ui";
import { useOverlay } from "@platform/overlay";
import { profilePath, navigate } from "../../../router.ts";
import { deleteFeedComment, type FeedComment } from "./api.ts";
import { VoteArrows } from "./vote.tsx";
import "./feed.css";

// CommentTree (docs/design/feed.post.editor.md §1.6/§7.2): первое место в проекте, где `parent_id`
// реально рисует вложенность (форум community.md §3.5 сегодня плоский). Визуальный кап глубины —
// не кап данных, сервер отдаёт дерево как есть, отступ просто перестаёт расти после 4 уровня.

const MAX_VISUAL_DEPTH = 4;
const WIDE_BRANCH_THRESHOLD = 8;

export interface CommentNode extends FeedComment {
  children: CommentNode[];
}

// Комментарии уже приходят с сервера отсортированными по выбранному критерию (best/new/top) —
// плоский порядок стабильно группируется по parent_id, так дети внутри каждого родителя
// наследуют тот же относительный порядок без пересортировки на клиенте.
export function buildCommentTree(comments: FeedComment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();
  for (const comment of comments) nodes.set(comment.id, { ...comment, children: [] });

  const roots: CommentNode[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id)!;
    const parent = comment.parent_id ? nodes.get(comment.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function countComments(nodes: CommentNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countComments(node.children), 0);
}

function Composer({
  user,
  autoFocus,
  placeholder = "Что скажете?",
  onSubmit,
  onCancel,
}: {
  user: SessionUser;
  autoFocus?: boolean;
  placeholder?: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    if (!value.trim() || sending) return;
    setSending(true);
    const ok = await onSubmit(value.trim());
    setSending(false);
    if (ok) setValue("");
  }

  return (
    <div className="feedCommentComposer">
      <div className="feedCommentComposerIdentity">
        <AvatarBubble config={deterministicAvatarConfig(user.username || user.id)} snapshots={null} size={26} facing="front" />
        <span>@{user.username}</span>
      </div>
      <textarea className="marketTextarea" aria-label="Комментарий" placeholder={placeholder} value={value} autoFocus={autoFocus} onChange={(event) => setValue(event.target.value)} rows={3} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {onCancel ? (
          <button type="button" className="modelGlassBtn pressable" onClick={onCancel}>
            Отмена
          </button>
        ) : null}
        <button type="button" className="modelGlassBtn pressable" disabled={!value.trim() || sending} onClick={() => void submit()}>
          {sending ? "Отправка…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}

function CommentNodeView({
  node,
  depth,
  user,
  onReply,
  onDeleted,
}: {
  node: CommentNode;
  depth: number;
  user: SessionUser;
  onReply: (parentId: string, body: string) => Promise<boolean>;
  onDeleted: (id: string) => void;
}) {
  const overlay = useOverlay();
  const [replying, setReplying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const mine = node.user_id === user.id;
  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH);
  const wideBranch = node.children.length >= WIDE_BRANCH_THRESHOLD;
  const showChildren = !wideBranch || expanded;

  async function handleDelete() {
    const confirmed = await overlay.confirm({
      severity: "critical",
      title: "Удалить комментарий?",
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await deleteFeedComment(node.id);
    if (!ok) {
      overlay.toast({ severity: "critical", title: "Не удалось удалить. Попробуйте ещё раз" });
      return;
    }
    onDeleted(node.id);
  }

  return (
    <div className="feedComment" data-depth={visualDepth} data-mine={mine || undefined}>
      <div className="feedCommentHead">
        {node.author?.avatar_config ? (
          <AvatarBubble config={node.author.avatar_config} snapshots={node.author.avatar_snapshots} size={26} facing="front" />
        ) : (
          <AvatarBubble
            config={deterministicAvatarConfig(node.author?.username ?? node.user_id)}
            snapshots={null}
            size={26}
            facing="front"
          />
        )}
        {node.author ? (
          <button type="button" className="feedPostCardHeaderLink" onClick={() => navigate(profilePath(node.author!.username))}>
            @{node.author.username}
          </button>
        ) : (
          <span>[удалённый пользователь]</span>
        )}
        <span>·</span>
        <span>{relativeDate(node.created_at)}</span>
        {mine ? <span className="feedCommentMineTag">вы</span> : null}
      </div>

      <div className="feedCommentBody">
        <MarkdownBody source={node.body} />
      </div>

      <div className="feedCommentRow">
        <VoteArrows user={user} subjectType="feed_comment" subjectId={node.id} votesUp={node.votes_up} votesDown={node.votes_down} myVote={node.my_vote ?? 0} />
        <button type="button" className="feedCommentReplyBtn pressable" onClick={() => setReplying((value) => !value)}>
          Ответить
        </button>
        {mine ? (
          <button type="button" className="feedCommentDeleteBtn pressable" aria-label="Удалить комментарий" onClick={() => void handleDelete()}>
            ⋯
          </button>
        ) : null}
      </div>

      {replying ? (
        <Composer
          user={user}
          autoFocus
          placeholder="Ваш ответ"
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            const ok = await onReply(node.id, body);
            if (ok) setReplying(false);
            return ok;
          }}
        />
      ) : null}

      {node.children.length > 0 ? (
        <div className="feedCommentChildren">
          {showChildren ? (
            node.children.map((child) => (
              <CommentNodeView key={child.id} node={child} depth={depth + 1} user={user} onReply={onReply} onDeleted={onDeleted} />
            ))
          ) : (
            <button type="button" className="feedCommentMore pressable" onClick={() => setExpanded(true)}>
              Показать ещё {node.children.length} ответов
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CommentTree({
  comments,
  user,
  onReply,
  onDeleted,
}: {
  comments: FeedComment[];
  user: SessionUser;
  onReply: (parentId: string, body: string) => Promise<boolean>;
  onDeleted: (id: string) => void;
}) {
  const tree = buildCommentTree(comments);
  if (tree.length === 0) return null;
  return (
    <div className="feedCommentTree">
      {tree.map((node) => (
        <CommentNodeView key={node.id} node={node} depth={0} user={user} onReply={onReply} onDeleted={onDeleted} />
      ))}
    </div>
  );
}

export { Composer as CommentComposer };
