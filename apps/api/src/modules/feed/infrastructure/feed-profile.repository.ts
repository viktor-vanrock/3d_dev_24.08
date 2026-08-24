import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { FeedProfileReadPort, FeedProfileStats } from "../public/index.ts";

@Injectable()
export class FeedProfileRepository implements FeedProfileReadPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async statsByAuthor(userId: UserId): Promise<FeedProfileStats> {
    const result = await this.pool.query<{
      posts_count: string;
      post_views_count: string;
      post_score: string;
      post_comments_count: string;
    }>(
      `select
         count(*) as posts_count,
         coalesce(sum((select count(*) from feed_events fe where fe.post_id = fp.id and fe.event_type = 'view')), 0) as post_views_count,
         coalesce(sum(fp.votes_up - fp.votes_down), 0) as post_score,
         coalesce(sum(fp.comments_count), 0) as post_comments_count
       from feed_posts fp
       where fp.author_id = $1 and fp.status = 'visible'`,
      [userId],
    );
    const row = result.rows[0]!;
    return {
      postsCount: Number(row.posts_count),
      postViewsCount: Number(row.post_views_count),
      postScore: Number(row.post_score),
      postCommentsCount: Number(row.post_comments_count),
    };
  }
}
