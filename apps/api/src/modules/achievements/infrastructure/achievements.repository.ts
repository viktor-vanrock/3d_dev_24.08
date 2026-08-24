import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { Achievement, EarnedAchievement, WardrobeRewardDefinition } from "../domain/achievements.ts";

type AchievementRow = Omit<Achievement, "granted_at"> & { readonly granted_at: Date | string };
type EarnedAchievementRow = Omit<EarnedAchievement, "granted_at"> & { readonly granted_at: Date | string };

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

@Injectable()
export class AchievementsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async achievements(userId: UserId): Promise<readonly Achievement[]> {
    const result = await this.pool.query<AchievementRow>(
      `select a.slug, a.title, a.description, ua.granted_at
       from user_achievements ua
       join achievements a on a.id = ua.achievement_id
       where ua.user_id = $1
       order by ua.granted_at desc`,
      [userId],
    );
    return result.rows.map((row) => ({ ...row, granted_at: serializeTimestamp(row.granted_at) }));
  }

  async wardrobeRewards(): Promise<readonly WardrobeRewardDefinition[]> {
    const result = await this.pool.query<WardrobeRewardDefinition>(
      `select layer, option_id, slug
       from wardrobe_rewards wr
       join achievements a on a.id = wr.achievement_id`,
    );
    return result.rows;
  }

  async earnedAchievements(userId: UserId): Promise<readonly EarnedAchievement[]> {
    const result = await this.pool.query<EarnedAchievementRow>(
      `select a.slug, ua.granted_at
       from user_achievements ua
       join achievements a on a.id = ua.achievement_id
       where ua.user_id = $1`,
      [userId],
    );
    return result.rows.map((row) => ({ ...row, granted_at: serializeTimestamp(row.granted_at) }));
  }

  async grantAchievement(userId: UserId, slug: string): Promise<boolean> {
    const result = await this.pool.query(
      `insert into user_achievements (user_id, achievement_id)
       select $1, id from achievements where slug = $2
       on conflict (user_id, achievement_id) do nothing
       returning id`,
      [userId, slug],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
