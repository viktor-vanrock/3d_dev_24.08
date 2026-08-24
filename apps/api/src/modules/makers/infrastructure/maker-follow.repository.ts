import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { MakerFollowReadPort, MakerFollowStats } from "../public/index.ts";

@Injectable()
export class MakerFollowRepository implements MakerFollowReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async stats(userId: UserId, viewerId: UserId | null): Promise<MakerFollowStats> {
    const result = await this.pool.query<{ followers: string; following: string; is_following: boolean }>(
      `select
         (select count(*) from user_follows where followee_id = $1) as followers,
         (select count(*) from user_follows where follower_id = $1) as following,
         exists(select 1 from user_follows where follower_id = $2 and followee_id = $1) as is_following`,
      [userId, viewerId],
    );
    const row = result.rows[0]!;
    return {
      followersCount: Number(row.followers),
      followingCount: Number(row.following),
      isFollowing: row.is_following,
    };
  }
}
