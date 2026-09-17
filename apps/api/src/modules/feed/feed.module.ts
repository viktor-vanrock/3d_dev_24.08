import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { FeedController } from "./api/feed.controller.ts";
import { FeedAdminController } from "./api/feed-admin.controller.ts";
import { FeedAdminService } from "./application/feed-admin.service.ts";
import { FeedService } from "./application/feed.service.ts";
import { FeedProfileRepository } from "./infrastructure/feed-profile.repository.ts";
import { FEED_ADMIN_PORT, FEED_PORT, FEED_PROFILE_READ_PORT, FEED_RANKING_READ_PORT, FEED_SOCIAL_OWNER_PORT } from "./public/index.ts";
import { FeedRepository } from "./infrastructure/feed.repository.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [FeedController, FeedAdminController],
  providers: [
    FeedRepository,
    FeedProfileRepository,
    FeedService,
    FeedAdminService,
    { provide: FEED_ADMIN_PORT, useExisting: FeedAdminService },
    { provide: FEED_PORT, useExisting: FeedService },
    { provide: FEED_SOCIAL_OWNER_PORT, useExisting: FeedService },
    { provide: FEED_PROFILE_READ_PORT, useExisting: FeedProfileRepository },
    { provide: FEED_RANKING_READ_PORT, useExisting: FeedRepository },
  ],
  exports: [FEED_PORT, FEED_PROFILE_READ_PORT, FEED_RANKING_READ_PORT, FEED_SOCIAL_OWNER_PORT],
})
export class FeedModule {}
