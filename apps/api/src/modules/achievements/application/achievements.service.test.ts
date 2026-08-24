import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { AchievementsRepository } from "../infrastructure/achievements.repository.ts";
import { AchievementsService } from "./achievements.service.ts";

const USER_ID = UserId("00000000-0000-0000-0000-000000000001");

function repositoryWithQueryResults(...results: Array<{ rows: unknown[]; rowCount?: number | null }>): {
  readonly repository: AchievementsRepository;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const result of results) query.mockResolvedValueOnce(result);
  return { repository: new AchievementsRepository({ query } as unknown as Pool), query };
}

describe("AchievementsService", () => {
  it("keeps reward-gated options locked until their achievement is earned", async () => {
    const { repository } = repositoryWithQueryResults({ rows: [{ layer: "outfit", option_id: "apron", slug: "first_make" }] }, { rows: [] });

    const unlocks = await new AchievementsService(repository).wardrobeUnlocks(USER_ID);

    expect(unlocks.layers.outfit).toContain("none");
    expect(unlocks.layers.outfit).not.toContain("apron");
    expect(unlocks.rewards).toEqual([]);
  });

  it("adds earned wardrobe rewards and preserves their grant timestamp", async () => {
    const grantedAt = new Date("2026-08-05T10:00:00.000Z");
    const { repository } = repositoryWithQueryResults(
      { rows: [{ layer: "outfit", option_id: "apron", slug: "first_make" }] },
      { rows: [{ slug: "first_make", granted_at: grantedAt }] },
    );

    const unlocks = await new AchievementsService(repository).wardrobeUnlocks(USER_ID);

    expect(unlocks.layers.outfit).toContain("apron");
    expect(unlocks.rewards).toEqual([
      {
        achievement_slug: "first_make",
        layer: "outfit",
        option_id: "apron",
        granted_at: grantedAt.toISOString(),
      },
    ]);
  });

  it("returns true only when the idempotent grant inserts a row", async () => {
    const first = repositoryWithQueryResults({ rows: [{ id: "grant-id" }], rowCount: 1 });
    const repeated = repositoryWithQueryResults({ rows: [], rowCount: 0 });

    await expect(new AchievementsService(first.repository).grantAchievement(USER_ID, "first_make")).resolves.toBe(true);
    await expect(new AchievementsService(repeated.repository).grantAchievement(USER_ID, "first_make")).resolves.toBe(false);
    expect(first.query).toHaveBeenCalledWith(expect.stringContaining("on conflict"), [USER_ID, "first_make"]);
  });
});
