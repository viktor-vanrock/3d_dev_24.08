import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { CommunityController } from "./api/community.controller.ts";
import { CommunityService } from "./application/community.service.ts";
import { CommunityRepository } from "./infrastructure/community.repository.ts";
import { COMMUNITY_FEED_READ_PORT, COMMUNITY_ORGANIZATION_PORT, COMMUNITY_PORT, COMMUNITY_SOCIAL_OWNER_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [CommunityController],
  providers: [
    CommunityRepository,
    CommunityService,
    { provide: COMMUNITY_PORT, useExisting: CommunityService },
    { provide: COMMUNITY_SOCIAL_OWNER_PORT, useExisting: CommunityService },
    { provide: COMMUNITY_ORGANIZATION_PORT, useExisting: CommunityRepository },
    { provide: COMMUNITY_FEED_READ_PORT, useExisting: CommunityRepository },
  ],
  exports: [COMMUNITY_PORT, COMMUNITY_SOCIAL_OWNER_PORT, COMMUNITY_ORGANIZATION_PORT, COMMUNITY_FEED_READ_PORT],
})
export class CommunityModule {}
