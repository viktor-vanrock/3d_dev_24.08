import { describe, expect, it, vi } from "vitest";
import { FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import { FeedRepository } from "./feed.repository.ts";

const actorId = UserId("00000000-0000-4000-8000-000000000001");
const postId = FeedPostId("00000000-0000-4000-8000-000000000002");

function row(status = "draft") {
  return {
    id: postId, author_id: actorId, co_author_agent_id: null, community_id: null, type: "text", title: "Новость", body: "Текст",
    model_id: null, media_s3_key: null, make_id: null, poster_s3_key: null, gitverse_url: null, gitverse_meta: null,
    votes_up: 0, votes_down: 0, comments_count: 0, status, created_at: new Date(0), is_edited: false, edited_at: null,
    source_url: null, source_fingerprint: null, ingest_provider: null, ingest_model: null, ingest_prompt_version: null,
  };
}

describe("FeedRepository admin audit", () => {
  it("создаёт draft и audit в одной транзакции", async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const release = vi.fn();
    const repository = new FeedRepository({ connect: vi.fn(async () => ({ query, release })) } as never);
    await repository.createAdmin(actorId, { communityId: null, title: "Новость", body: "Текст" });
    expect(String(query.mock.calls[1]?.[0])).toContain("insert into feed_posts");
    expect(String(query.mock.calls[2]?.[0])).toContain("insert into audit_log");
    expect(query.mock.calls[3]?.[0]).toBe("commit");
    expect(release).toHaveBeenCalledOnce();
  });

  it("откатывает mutation, если audit не записался", async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row()] }).mockRejectedValueOnce(new Error("audit failed")).mockResolvedValueOnce({});
    const repository = new FeedRepository({ connect: vi.fn(async () => ({ query, release: vi.fn() })) } as never);
    await expect(repository.createAdmin(actorId, { communityId: null, title: "Новость", body: "Текст" })).rejects.toThrow("audit failed");
    expect(query.mock.calls[3]?.[0]).toBe("rollback");
  });

  it("передаёт явный null при очистке community", async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const repository = new FeedRepository({ connect: vi.fn(async () => ({ query, release: vi.fn() })) } as never);
    await repository.updateAdmin(actorId, postId, { communityId: null });
    expect(String(query.mock.calls[1]?.[0])).toContain("where id=$1");
    expect(query.mock.calls[1]?.[1]).toEqual([postId, null, null, true, null]);
    expect(query.mock.calls[2]?.[1]?.[0]).toBe(actorId);
  });

  it("нумерует параметры lifecycle-запроса с $1 и пишет actorId только в audit", async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row("visible")] }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const repository = new FeedRepository({ connect: vi.fn(async () => ({ query, release: vi.fn() })) } as never);
    await repository.transitionAdminStatus(actorId, postId, "visible", ["draft", "visible", "hidden"]);
    expect(String(query.mock.calls[1]?.[0])).toContain("status=$2");
    expect(String(query.mock.calls[1]?.[0])).toContain("id=$1");
    expect(String(query.mock.calls[1]?.[0])).toContain("any($3::text[])");
    expect(query.mock.calls[1]?.[1]).toEqual([postId, "visible", ["draft", "visible", "hidden"]]);
    expect(query.mock.calls[2]?.[1]?.[0]).toBe(actorId);
  });

  it.each([
    ["update", (repository: FeedRepository) => repository.updateAdmin(actorId, postId, { title: "Исправлено" })],
    ["transition", (repository: FeedRepository) => repository.transitionAdminStatus(actorId, postId, "visible", ["draft"])],
  ])("откатывает %s, если audit не записался", async (_name, mutate) => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [row()] }).mockRejectedValueOnce(new Error("audit failed")).mockResolvedValueOnce({});
    const repository = new FeedRepository({ connect: vi.fn(async () => ({ query, release: vi.fn() })) } as never);
    await expect(mutate(repository)).rejects.toThrow("audit failed");
    expect(query.mock.calls[3]?.[0]).toBe("rollback");
  });
});
