import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { Readable } from "node:stream";
import { getModelObjectStream, isModelsStorageConfigured, modelPublicUrl, putModelObjectStream } from "../../storage/s3.ts";
import { AnalyticsModule } from "../../modules/analytics/analytics.module.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../modules/analytics/public/index.ts";
import { FeedModule } from "../../modules/feed/feed.module.ts";
import { FEED_PORT, type FeedPort } from "../../modules/feed/public/index.ts";
import { ProfileModule } from "../../modules/profile/profile.module.ts";
import { PROFILE_ADMIN_PORT, PROFILE_READ_PORT, type ProfileAdminPort, type ProfileReadPort } from "../../modules/profile/public/index.ts";
import type { UserId } from "../../modules/_kernel/brandedIds.ts";
import { CatalogModule } from "../../modules/catalog/catalog.module.ts";
import { CATALOG_READ_PORT, type CatalogReadPort } from "../../modules/catalog/public/index.ts";
import { CommunityOwnerModule } from "../../modules/community/community-owner.module.ts";
import {
  awardAcceptedAnswer,
  awardPostVote,
  awardThreadVote,
  COMMUNITY_ANALYTICS_PORT,
  COMMUNITY_CATALOG_PORT,
  COMMUNITY_FEED_PORT,
  COMMUNITY_MODELS_PORT,
  COMMUNITY_PROFILE_PORT,
  COMMUNITY_REPUTATION_PORT,
  COMMUNITY_STORAGE_PORT,
  COMMUNITY_ORGANIZATION_PORT,
  resolvedModelsForPosts,
  type CommunityAnalyticsPort,
  type CommunityCatalogPort,
  type CommunityFeedPort,
  type CommunityModelsPort,
  type CommunityOrganizationPort,
  type CommunityProfilePort,
  type CommunityRecord,
  type CommunityReputationPort,
  type CommunityStoragePort,
  type StoredObject,
} from "../../modules/community/public/index.ts";

@Injectable()
export class CommunityFeedAdapter implements CommunityFeedPort {
  constructor(@Inject(FEED_PORT) private readonly feed: FeedPort) {}
  async list(input: { communityId: string; sort: string; limit: number; cursor: string | null }) {
    const result = await this.feed.list({ community_id: input.communityId, sort: input.sort, limit: input.limit, cursor: input.cursor ?? undefined }, null);
    return { items: result.items, next_cursor: result.next_cursor };
  }
}

@Injectable()
export class CommunityCatalogAdapter implements CommunityCatalogPort {
  constructor(
    @Inject(CATALOG_READ_PORT) private readonly catalog: CatalogReadPort,
    @Inject(COMMUNITY_ORGANIZATION_PORT) private readonly communities: CommunityOrganizationPort,
  ) {}
  async enrich(rows: readonly CommunityRecord[]): Promise<readonly CommunityRecord[]> {
    const vendorIds = rows.filter((row) => row.kind === "vendor" && row.subject_id !== null).map((row) => row.subject_id!);
    const machineIds = rows.filter((row) => row.kind === "machine" && row.subject_id !== null).map((row) => row.subject_id!);
    const [vendorWebsites, machineWebsites] = await Promise.all([this.catalog.vendorWebsites(vendorIds), this.catalog.machineVendorWebsites(machineIds)]);
    return rows.map((row) => ({
      ...row,
      website:
        row.subject_id === null
          ? null
          : row.kind === "vendor"
            ? (vendorWebsites.get(row.subject_id) ?? null)
            : row.kind === "machine"
              ? (machineWebsites.get(row.subject_id) ?? null)
              : null,
    }));
  }
  async related(communityId: string): Promise<readonly { id: string; slug: string; name: string; kind: string }[]> {
    const subject = await this.communities.activeCatalogSubject(communityId);
    if (subject?.subjectId === null || subject?.subjectId === undefined) return [];
    const vendorId = subject.kind === "vendor" ? subject.subjectId : subject.kind === "machine" ? await this.catalog.machineVendorId(subject.subjectId) : null;
    if (vendorId === null) return [];
    return this.communities.relatedCatalogCommunities(communityId, vendorId, await this.catalog.machineIdsForVendor(vendorId));
  }
}

@Injectable()
export class CommunityModelsAdapter implements CommunityModelsPort {
  resolve(posts: readonly { id: string; content: string }[]) {
    return resolvedModelsForPosts([...posts]);
  }
}

@Injectable()
export class CommunityProfileAdapter implements CommunityProfilePort {
  constructor(
    @Inject(PROFILE_ADMIN_PORT) private readonly admin: ProfileAdminPort,
    @Inject(PROFILE_READ_PORT) private readonly profiles: ProfileReadPort,
  ) {}
  isStaff(userId: UserId): Promise<boolean> {
    return this.admin.isStaff(userId);
  }
  async exists(userId: UserId): Promise<boolean> {
    return (await this.profiles.findById(userId)) !== null;
  }
}

@Injectable()
export class CommunityAnalyticsAdapter implements CommunityAnalyticsPort {
  constructor(@Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort) {}
  async subscription(input: Parameters<CommunityAnalyticsPort["subscription"]>[0]): Promise<void> {
    await this.analytics.emitEvent({
      anonId: null,
      userId: input.userId,
      eventName: "community_subscribe",
      props: {
        community_id: input.communityId,
        community_kind: input.kind,
        action: input.action,
        source: input.source,
      },
    });
  }
}

@Injectable()
export class CommunityReputationAdapter implements CommunityReputationPort {
  async postVote(post: Parameters<CommunityReputationPort["postVote"]>[0], value: 1 | -1): Promise<void> {
    await awardPostVote(post, value);
  }
  async threadVote(thread: Parameters<CommunityReputationPort["threadVote"]>[0], value: 1 | -1): Promise<void> {
    await awardThreadVote(thread, value);
  }
  async accepted(post: Parameters<CommunityReputationPort["accepted"]>[0]): Promise<void> {
    await awardAcceptedAnswer(post);
  }
}

@Injectable()
export class CommunityStorageAdapter implements CommunityStoragePort {
  configured(): boolean {
    return isModelsStorageConfigured();
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await putModelObjectStream(key, Readable.from(body), contentType);
  }
  get(key: string): Promise<StoredObject | null> {
    return getModelObjectStream(key);
  }
  publicUrl(key: string): string | null {
    return modelPublicUrl(key);
  }
}

@Global()
@Module({
  imports: [AnalyticsModule, CatalogModule, CommunityOwnerModule, FeedModule, ProfileModule],
  providers: [
    CommunityFeedAdapter,
    CommunityCatalogAdapter,
    CommunityModelsAdapter,
    CommunityProfileAdapter,
    CommunityAnalyticsAdapter,
    CommunityReputationAdapter,
    CommunityStorageAdapter,
    { provide: COMMUNITY_FEED_PORT, useExisting: CommunityFeedAdapter },
    { provide: COMMUNITY_CATALOG_PORT, useExisting: CommunityCatalogAdapter },
    { provide: COMMUNITY_MODELS_PORT, useExisting: CommunityModelsAdapter },
    { provide: COMMUNITY_PROFILE_PORT, useExisting: CommunityProfileAdapter },
    { provide: COMMUNITY_ANALYTICS_PORT, useExisting: CommunityAnalyticsAdapter },
    { provide: COMMUNITY_REPUTATION_PORT, useExisting: CommunityReputationAdapter },
    { provide: COMMUNITY_STORAGE_PORT, useExisting: CommunityStorageAdapter },
  ],
  exports: [
    COMMUNITY_FEED_PORT,
    COMMUNITY_CATALOG_PORT,
    COMMUNITY_MODELS_PORT,
    COMMUNITY_PROFILE_PORT,
    COMMUNITY_ANALYTICS_PORT,
    COMMUNITY_REPUTATION_PORT,
    COMMUNITY_STORAGE_PORT,
  ],
})
export class CommunityIntegrationModule {}
