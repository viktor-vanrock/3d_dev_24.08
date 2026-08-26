import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PoolClient } from "pg";

export const PROFILE_READ_PORT = Symbol("PROFILE_READ_PORT");
export const PROFILE_ADMIN_PORT = Symbol("PROFILE_ADMIN_PORT");
export const PROFILE_AUTH_PORT = Symbol("PROFILE_AUTH_PORT");
export const PROFILE_AGGREGATES_PORT = Symbol("PROFILE_AGGREGATES_PORT");
export const PROFILE_CONTENT_PORT = Symbol("PROFILE_CONTENT_PORT");
export const PROFILE_MASTER_PORT = Symbol("PROFILE_MASTER_PORT");
export const PROFILE_SANCTIONS_PORT = Symbol("PROFILE_SANCTIONS_PORT");

export interface PublicProfile {
  readonly id: UserId;
  readonly username: string;
  readonly displayName: string | null;
}

export interface ProfileReadPort {
  findById(userId: UserId): Promise<PublicProfile | null>;
  findByUsername(username: string): Promise<PublicProfile | null>;
  findActiveByUsername(username: string): Promise<PublicProfile | null>;
  findActiveByIds(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, PublicProfile>>;
}

export interface ProfileAdminPort {
  isStaff(userId: UserId): Promise<boolean>;
  banUser(userId: UserId): Promise<{ readonly status: "banned"; readonly transitioned: boolean } | "not_found">;
}

export interface PublicContentAuthor {
  readonly id: UserId;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly reputationScore: number;
  readonly trustLevel: number;
}

export interface ProfileContentPort {
  findAuthors(userIds: readonly UserId[]): Promise<ReadonlyMap<UserId, PublicContentAuthor>>;
  isStaff(userId: UserId): Promise<boolean>;
  role(userId: UserId): Promise<"user" | "researcher" | null>;
  trustState(userId: UserId): Promise<{ readonly trustLevel: number; readonly reputationScore: number; readonly createdAt: Date } | null>;
}

export interface ProfileMasterState {
  readonly id: UserId;
  readonly isMaster: boolean;
  readonly masterProfile: unknown;
}

export interface PublicMasterProfile {
  readonly id: UserId;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly masterProfile: unknown;
}

export interface ProfileMasterPort {
  findMasterState(userId: UserId): Promise<ProfileMasterState | null>;
  becomeMaster(userId: UserId): Promise<ProfileMasterState | null>;
  updateMasterProfile(userId: UserId, profile: Readonly<Record<string, string | null>>): Promise<ProfileMasterState | null>;
  findActiveMaster(userId: UserId): Promise<PublicMasterProfile | null>;
}

export interface SessionProfile {
  readonly id: UserId;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly handleConfirmed: boolean;
  readonly role: "user" | "researcher";
}

export interface NewUserSeed {
  readonly handle: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

export interface ProfileAuthPort {
  findSessionUser(userId: UserId): Promise<SessionProfile | null>;
  loadOwnerAuthState(userId: UserId): Promise<{ readonly status: "active" | "banned" | "deleted"; readonly sessionVersion: number } | null>;
  bumpSessionVersion(userId: UserId): Promise<boolean>;
  createUserWithFreeHandle(seed: NewUserSeed): Promise<UserId>;
  upsertDevUser(): Promise<SessionProfile | null>;
}

/** Transaction-aware mutations for the sanctions cascade. The caller owns BEGIN/COMMIT. */
export interface ProfileSanctionsPort {
  restrictForSanction(tx: PoolClient, input: { readonly userId: UserId }): Promise<{ readonly changed: boolean; readonly sessionVersion: number }>;
  activateAfterSanctionExpiry(tx: PoolClient, input: { readonly userId: UserId }): Promise<{ readonly changed: boolean }>;
  isBootstrapAdmin(tx: PoolClient, input: { readonly userId: UserId; readonly adminUsername: string }): Promise<boolean>;
}

export interface ProfileAggregates {
  readonly modelsCount: number;
  readonly projectViewsCount: number;
  readonly projectDownloadsCount: number;
  readonly postsCount: number;
  readonly postViewsCount: number;
  readonly postScore: number;
  readonly postCommentsCount: number;
  readonly printersCount: number;
  readonly followersCount: number;
  readonly followingCount: number;
  readonly isFollowing: boolean;
}

export interface ProfileAggregatesPort {
  forUser(userId: UserId, viewerId: UserId | null): Promise<ProfileAggregates>;
}
export { ProfileInventoryCatalogAdapter } from "../application/profile-owner-read.adapters.ts";
export {
  PROFILE_DEVICE_OPERATIONS_PORT,
  PROFILE_INVENTORY_CATALOG_PORT,
  type ProfileDeviceOperationsPort,
  type ProfileInventoryCatalogPort,
  type QueueProfilePrinterCommand,
} from "../application/profile-inventory.ports.ts";
export type {
  InventoryMaterialDescription,
  PrinterCommandStatusProjection,
  PrinterCompatibilityProjection,
  PrinterLiveProjection,
  PrinterOperatingProjection,
  PrinterQueuedCommandProjection,
  UserInventoryRecord,
  UserPrinterRecord,
} from "../domain/inventory.types.ts";
