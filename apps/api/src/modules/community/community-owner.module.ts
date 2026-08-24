import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { CommunityRepository } from "./infrastructure/community.repository.ts";
import { COMMUNITY_FEED_READ_PORT, COMMUNITY_ORGANIZATION_PORT, COMMUNITY_SOCIAL_OWNER_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  providers: [
    CommunityRepository,
    { provide: COMMUNITY_FEED_READ_PORT, useExisting: CommunityRepository },
    { provide: COMMUNITY_ORGANIZATION_PORT, useExisting: CommunityRepository },
    { provide: COMMUNITY_SOCIAL_OWNER_PORT, useExisting: CommunityRepository },
  ],
  exports: [COMMUNITY_FEED_READ_PORT, COMMUNITY_ORGANIZATION_PORT, COMMUNITY_SOCIAL_OWNER_PORT],
})
export class CommunityOwnerModule {}
