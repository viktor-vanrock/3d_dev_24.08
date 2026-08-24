import { describe, expect, it, vi } from "vitest";
import { MakeId, UserId } from "../../_kernel/brandedIds.ts";
import type { AchievementsPort } from "../../achievements/public/index.ts";
import type { CatalogMakesPort } from "../../catalog/public/index.ts";
import type { FeedSocialOwnerPort } from "../../feed/public/index.ts";
import type { ModelMakesPort } from "../../models/public/index.ts";
import type { ReportsPort } from "../../moderation/public/index.ts";
import type { MakesRepository } from "../infrastructure/makes.repository.ts";
import type { MakeCommentsPort, MakeFeedSignalPort, MakeProfilePort, MakeRateLimitPort, MakeStoragePort, MakeTagsPort, MakeVotesPort } from "../public/index.ts";
import { MakesService } from "./makes.service.ts";

function stub<T>(value: Partial<T>): T {
  return value as T;
}

function service(
  repository: Partial<MakesRepository>,
  overrides: {
    votes?: Partial<MakeVotesPort>;
    comments?: Partial<MakeCommentsPort>;
  } = {},
) {
  return new MakesService(
    stub(repository),
    stub<ModelMakesPort>({ findMany: vi.fn().mockResolvedValue(new Map()) }),
    stub<CatalogMakesPort>({}),
    stub<MakeProfilePort>({}),
    stub<MakeTagsPort>({}),
    stub<MakeVotesPort>(overrides.votes ?? {}),
    stub<MakeCommentsPort>(overrides.comments ?? {}),
    stub<FeedSocialOwnerPort>({}),
    stub<MakeFeedSignalPort>({}),
    stub<ReportsPort>({}),
    stub<AchievementsPort>({}),
    stub<MakeStoragePort>({}),
    stub<MakeRateLimitPort>({}),
  );
}

describe("MakesService owner boundaries", () => {
  it("delegates the polymorphic vote and only persists the returned make aggregate", async () => {
    const publishedExists = vi.fn().mockResolvedValue(true);
    const setLikesCount = vi.fn().mockResolvedValue(undefined);
    const toggleLike = vi.fn().mockResolvedValue({ liked: false, likesCount: 4 });
    const target = service({ publishedExists, setLikesCount }, { votes: { toggleLike } });
    const makeId = MakeId("11111111-1111-4111-8111-111111111111");
    const userId = UserId("22222222-2222-4222-8222-222222222222");

    await expect(target.vote(makeId, userId)).resolves.toEqual({ liked: false, likes_count: 4 });
    expect(toggleLike).toHaveBeenCalledWith(makeId, userId);
    expect(setLikesCount).toHaveBeenCalledWith(makeId, 4);
  });

  it("delegates comment creation and updates only the make counter", async () => {
    const record = { id: "33333333-3333-4333-8333-333333333333", body: "ok" };
    const publishedExists = vi.fn().mockResolvedValue(true);
    const incrementComments = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(record);
    const target = service({ publishedExists, incrementComments }, { comments: { create } });
    const makeId = MakeId("11111111-1111-4111-8111-111111111111");
    const userId = UserId("22222222-2222-4222-8222-222222222222");

    await expect(target.comment(makeId, userId, "ok", undefined)).resolves.toBe(record);
    expect(create).toHaveBeenCalledWith({ makeId, userId, body: "ok", parentId: null });
    expect(incrementComments).toHaveBeenCalledWith(makeId);
  });

  it("keeps published counter mutations at status 200 success shape", async () => {
    const increment = vi.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(11);
    const target = service({ increment });
    const makeId = MakeId("11111111-1111-4111-8111-111111111111");
    await expect(target.repost(makeId)).resolves.toEqual({ reposts_count: 7 });
    await expect(target.view(makeId)).resolves.toEqual({ views_count: 11 });
  });
});
