import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { FeedController } from "./api/feed.controller.ts";
import { FeedService } from "./application/feed.service.ts";
import { FeedProfileRepository } from "./infrastructure/feed-profile.repository.ts";
import { FEED_PORT, FEED_PROFILE_READ_PORT, FEED_RANKING_READ_PORT, FEED_SOCIAL_OWNER_PORT } from "./public/index.ts";
import { FeedRepository } from "./infrastructure/feed.repository.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [FeedController],
  providers: [
    FeedRepository,
    FeedProfileRepository,
    FeedService,
    { provide: FEED_PORT, useExisting: FeedService },
    { provide: FEED_SOCIAL_OWNER_PORT, useExisting: FeedService },
    { provide: FEED_PROFILE_READ_PORT, useExisting: FeedProfileRepository },
    { provide: FEED_RANKING_READ_PORT, useExisting: FeedRepository },
  ],
  exports: [FEED_PORT, FEED_PROFILE_READ_PORT, FEED_RANKING_READ_PORT, FEED_SOCIAL_OWNER_PORT],
})
export class FeedModule {}
