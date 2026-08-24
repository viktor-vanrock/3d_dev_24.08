import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { FeedSocialOwnerService } from "./application/feed-social-owner.service.ts";
import { FeedRepository } from "./infrastructure/feed.repository.ts";
import { FEED_RANKING_READ_PORT, FEED_SOCIAL_OWNER_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  providers: [
    FeedRepository,
    FeedSocialOwnerService,
    { provide: FEED_SOCIAL_OWNER_PORT, useExisting: FeedSocialOwnerService },
    { provide: FEED_RANKING_READ_PORT, useExisting: FeedRepository },
  ],
  exports: [FEED_RANKING_READ_PORT, FEED_SOCIAL_OWNER_PORT],
})
export class FeedSocialOwnerModule {}
