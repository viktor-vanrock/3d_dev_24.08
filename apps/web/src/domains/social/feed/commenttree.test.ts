import { describe, expect, it } from "vitest";
import { buildCommentTree, countComments, type CommentNode } from "./commenttree.tsx";
import type { FeedComment } from "./api.ts";

function comment(id: string, parentId: string | null): FeedComment {
  return { id, user_id: `u${id}`, parent_id: parentId, body: `body ${id}`, votes_up: 0, votes_down: 0, created_at: new Date().toISOString() };
}

describe("buildCommentTree (feed.post.editor.md §1.6 — реальная вложенность)", () => {
  it("плоский список без parent_id — все корни", () => {
    const tree = buildCommentTree([comment("1", null), comment("2", null)]);
    expect(tree.map((n) => n.id)).toEqual(["1", "2"]);
  });

  it("группирует детей под родителем, сохраняя относительный порядок", () => {
    const tree = buildCommentTree([comment("1", null), comment("2", "1"), comment("3", "1"), comment("4", null)]);
    expect(tree.map((n) => n.id)).toEqual(["1", "4"]);
    expect(tree[0]!.children.map((n) => n.id)).toEqual(["2", "3"]);
  });

  it("вложенность на любом уровне (parent сам имеет parent)", () => {
    const tree = buildCommentTree([comment("1", null), comment("2", "1"), comment("3", "2")]);
    expect(tree[0]!.children[0]!.children.map((n) => n.id)).toEqual(["3"]);
  });

  it("комментарий с parent_id, которого нет в наборе (странице показали только часть) — не роняет, уходит в корень", () => {
    const tree = buildCommentTree([comment("2", "missing")]);
    expect(tree.map((n) => n.id)).toEqual(["2"]);
  });
});

describe("countComments", () => {
  it("считает узлы дерева рекурсивно", () => {
    const nodes: CommentNode[] = buildCommentTree([comment("1", null), comment("2", "1"), comment("3", "2"), comment("4", null)]);
    expect(countComments(nodes)).toBe(4);
  });

  it("пустое дерево → 0", () => {
    expect(countComments([])).toBe(0);
  });
});
