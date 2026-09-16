import { describe, expect, it, vi } from "vitest";
import { FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import type { FeedPostRecord } from "../domain/feed.ts";
import { FeedAdminService } from "./feed-admin.service.ts";

const actorId = UserId("00000000-0000-0000-0000-000000000001");
const postId = FeedPostId("00000000-0000-0000-0000-000000000002");

function record(status: string, sourceUrl: string | null = null): FeedPostRecord {
  return {
    id: postId, author_id: actorId, co_author_agent_id: null, community_id: null, type: "text", title: "Новость",
    body: "Текст", model_id: null, media_s3_key: null, make_id: null, poster_s3_key: null, gitverse_url: null,
    gitverse_meta: null, votes_up: 0, votes_down: 0, comments_count: 0, status, created_at: new Date("2026-09-14T12:00:00Z"),
    is_edited: false, edited_at: null, source_url: sourceUrl, source_fingerprint: sourceUrl ? "fingerprint" : null,
    ingest_provider: sourceUrl ? "scout" : null, ingest_model: sourceUrl ? "model" : null, ingest_prompt_version: sourceUrl ? "v2" : null,
  };
}

function repository(overrides: Partial<ConstructorParameters<typeof FeedAdminService>[0]> = {}): ConstructorParameters<typeof FeedAdminService>[0] {
  return {
    listAdmin: vi.fn(async () => []),
    find: vi.fn(async () => null),
    createAdmin: vi.fn(async () => record("draft")),
    updateAdmin: vi.fn(async () => null),
    transitionAdminStatus: vi.fn(async () => null),
    ...overrides,
  };
}

describe("FeedAdminService", () => {
  it("создаёт ручную новость только как draft", async () => {
    const repo = repository({ createAdmin: vi.fn(async () => record("draft")) });
    const service = new FeedAdminService(repo);
    const result = await service.create(actorId, { title: " Новость ", body: "Текст" });
    expect(repo.createAdmin).toHaveBeenCalledWith(actorId, expect.objectContaining({ title: "Новость" }));
    expect(result.item.status).toBe("draft");
    expect(result.item.source).toBe("manual");
  });

  it("публикует draft идемпотентно", async () => {
    const repo = repository({
      transitionAdminStatus: vi.fn(async () => record("visible")),
    });
    const service = new FeedAdminService(repo);
    await expect(service.publish(actorId, postId)).resolves.toMatchObject({ item: { status: "published" } });
    expect(repo.transitionAdminStatus).toHaveBeenCalledWith(actorId, postId, "visible", ["draft", "visible", "hidden"]);
  });

  it("повторно публикует скрытую новость", async () => {
    const repo = repository({
      transitionAdminStatus: vi.fn(async () => record("visible")),
    });
    const service = new FeedAdminService(repo);
    await expect(service.publish(actorId, postId)).resolves.toMatchObject({ item: { status: "published" } });
    expect(repo.transitionAdminStatus).toHaveBeenCalledWith(actorId, postId, "visible", ["draft", "visible", "hidden"]);
  });

  it("различает Scout и ручные записи в списке", async () => {
    const repo = repository({ listAdmin: vi.fn(async () => [record("draft", "https://vendor.example/news"), record("visible")]) });
    const service = new FeedAdminService(repo);
    const result = await service.list({ status: "all", source: "all" });
    expect(result.items.map((item) => item.source)).toEqual(["scout", "manual"]);
  });

  it("передаёт явный null для очистки community", async () => {
    const repo = repository({ updateAdmin: vi.fn(async () => record("draft")) });
    const service = new FeedAdminService(repo);
    await service.update(actorId, postId, { community_id: null });
    expect(repo.updateAdmin).toHaveBeenCalledWith(actorId, postId, { title: undefined, body: undefined, communityId: null });
  });
});
