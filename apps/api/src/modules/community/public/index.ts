import type { UserId } from "../../_kernel/brandedIds.ts";
export const COMMUNITY_PORT = Symbol("COMMUNITY_PORT");
export const COMMUNITY_SOCIAL_OWNER_PORT = Symbol("COMMUNITY_SOCIAL_OWNER_PORT");
export const COMMUNITY_ORGANIZATION_PORT = Symbol("COMMUNITY_ORGANIZATION_PORT");
export const COMMUNITY_FEED_READ_PORT = Symbol("COMMUNITY_FEED_READ_PORT");
export type { CommunityPort } from "../application/community.ports.ts";
export { ensureCatalogCommunity } from "../infrastructure/catalogCommunity.ts";
export { ensureOwnedTags, findOwnedTagIds, findOwnedTagNames, listOwnedTags, searchOwnedTags, type OwnedTagSearchRecord } from "../infrastructure/community-owner.ts";
export interface CommunitySocialOwnerPort {
  applyVote(
    subjectType: string,
    subjectId: string,
    userId: UserId,
    value: 1 | -1 | 0,
  ): Promise<{ readonly votesUp: number; readonly votesDown: number; readonly isNewCast: boolean; readonly castValue: 1 | -1 | null }>;
  togglePositiveVote(subjectType: string, subjectId: string, userId: UserId): Promise<{ readonly liked: boolean; readonly likesCount: number }>;
  applyWeightedVote(
    subjectType: string,
    subjectId: string,
    userId: UserId,
    value: 1 | -1 | 0,
    trustSnapshot: number,
  ): Promise<{ readonly up: number; readonly down: number; readonly upWeighted: number; readonly downWeighted: number }>;
  findTagIdByName(name: string): Promise<string | null>;
}

export interface CommunityFeedReadPort {
  findActive(communityId: string): Promise<{ readonly id: string; readonly kind: string } | null>;
  isMember(communityId: string, userId: UserId): Promise<boolean>;
  subscribedCommunityIds(userId: UserId): Promise<readonly string[]>;
  canIngest(communityId: string, userId: UserId): Promise<boolean>;
  gateState(communityId: string): Promise<{ readonly createdAt: Date; readonly kind: string } | null>;
  communityIdsWithAnyTags(communityIds: readonly string[], tagIds: readonly string[]): Promise<ReadonlySet<string>>;
}

export interface CommunityOrganizationSubject {
  readonly kind: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
}

export interface CommunityOrganizationPort {
  activeCatalogSubject(communityId: string): Promise<CommunityOrganizationSubject | null>;
  currentOwner(communityId: string): Promise<UserId | null>;
  grantVendorClaimOwner(communityId: string, userId: UserId): Promise<"owner">;
  /** The transaction is an opaque owner-supplied database transaction used to preserve legacy atomicity. */
  revokeVendorClaimMemberships(transaction: unknown, userId: UserId, vendorId: string, machineIds: readonly string[]): Promise<void>;
  relatedCatalogCommunities(
    currentCommunityId: string,
    vendorId: string,
    machineIds: readonly string[],
  ): Promise<readonly { readonly id: string; readonly slug: string; readonly name: string; readonly kind: string }[]>;
}
export { awardAcceptedAnswer, awardPostVote, awardThreadVote } from "../infrastructure/reputation.ts";
export { resolvedModelsForPosts } from "../infrastructure/modelrefs.ts";
export {
  COMMUNITY_ANALYTICS_PORT,
  COMMUNITY_CATALOG_PORT,
  COMMUNITY_FEED_PORT,
  COMMUNITY_MODELS_PORT,
  COMMUNITY_PROFILE_PORT,
  COMMUNITY_REPUTATION_PORT,
  COMMUNITY_STORAGE_PORT,
  type CommunityAnalyticsPort,
  type CommunityCatalogPort,
  type CommunityFeedPort,
  type CommunityModelsPort,
  type CommunityProfilePort,
  type CommunityRecord,
  type CommunityReputationPort,
  type CommunityStoragePort,
  type StoredObject,
} from "../application/community.ports.ts";
