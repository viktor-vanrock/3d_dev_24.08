import { Inject, Injectable } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { WARDROBE_LAYERS, type Achievement, type WardrobeUnlockLayers, type WardrobeUnlocks } from "../domain/achievements.ts";
import { AchievementsRepository } from "../infrastructure/achievements.repository.ts";
import type { AchievementsPort } from "../public/index.ts";

@Injectable()
export class AchievementsService implements AchievementsPort {
  constructor(@Inject(AchievementsRepository) private readonly repository: AchievementsRepository) {}

  achievements(userId: UserId): Promise<readonly Achievement[]> {
    return this.repository.achievements(userId);
  }

  async wardrobeUnlocks(userId: UserId): Promise<WardrobeUnlocks> {
    const [rewards, earned] = await Promise.all([this.repository.wardrobeRewards(), this.repository.earnedAchievements(userId)]);
    const grantedAtBySlug = new Map(earned.map((achievement) => [achievement.slug, achievement.granted_at]));
    const gatedByLayer = new Map<keyof typeof WARDROBE_LAYERS, Set<string>>();

    for (const reward of rewards) {
      const gated = gatedByLayer.get(reward.layer) ?? new Set<string>();
      gated.add(reward.option_id);
      gatedByLayer.set(reward.layer, gated);
    }

    const layers = {} as WardrobeUnlockLayers;
    for (const layer of Object.keys(WARDROBE_LAYERS) as Array<keyof typeof WARDROBE_LAYERS>) {
      const gated = gatedByLayer.get(layer) ?? new Set<string>();
      layers[layer] = WARDROBE_LAYERS[layer].filter((option) => !gated.has(option));
    }

    const grantedRewards = rewards.flatMap((reward) => {
      const grantedAt = grantedAtBySlug.get(reward.slug);
      if (grantedAt === undefined) return [];
      if (!layers[reward.layer].includes(reward.option_id)) layers[reward.layer].push(reward.option_id);
      return [
        {
          achievement_slug: reward.slug,
          layer: reward.layer,
          option_id: reward.option_id,
          granted_at: grantedAt,
        },
      ];
    });

    return { layers, rewards: grantedRewards };
  }

  grantAchievement(userId: UserId, slug: string): Promise<boolean> {
    return this.repository.grantAchievement(userId, slug);
  }
}
