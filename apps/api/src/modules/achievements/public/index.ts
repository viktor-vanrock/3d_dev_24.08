import type { UserId } from "../../_kernel/brandedIds.ts";
import type { Achievement, WardrobeUnlocks } from "../domain/achievements.ts";

export const ACHIEVEMENTS_PORT = Symbol("ACHIEVEMENTS_PORT");

export interface AchievementsPort {
  achievements(userId: UserId): Promise<readonly Achievement[]>;
  wardrobeUnlocks(userId: UserId): Promise<WardrobeUnlocks>;
  grantAchievement(userId: UserId, slug: string): Promise<boolean>;
}

export type { Achievement, WardrobeUnlocks };
