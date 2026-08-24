import type { OrganizationId, UserId } from "../../_kernel/brandedIds.ts";
import type { VendorClaimStatus } from "../domain/organizations.ts";

export const ORGANIZATIONS_PORT = Symbol("ORGANIZATIONS_PORT");
export const ORGANIZATIONS_EXTERNAL_PORT = Symbol("ORGANIZATIONS_EXTERNAL_PORT");

export interface VendorClaimRecord {
  readonly id: string;
  readonly vendor_id: string;
  readonly claimant_user_id: UserId;
  readonly organization_name: string;
  readonly evidence_url: string | null;
  readonly evidence_note: string | null;
  readonly status: VendorClaimStatus;
  readonly organization_id: OrganizationId | null;
  readonly reviewed_by: UserId | null;
  readonly reviewed_at: Date | null;
  readonly review_note: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface OrganizationsExternalPort {
  isStaff(userId: UserId): Promise<boolean>;
  vendorExists(vendorId: string): Promise<boolean>;
  machineVendorId(machineId: string): Promise<string | null>;
  activeCommunitySubject(communityId: string): Promise<{
    readonly kind: string;
    readonly subjectType: string | null;
    readonly subjectId: string | null;
  } | null>;
  currentCommunityOwner(communityId: string): Promise<UserId | null>;
  grantVendorClaimOwner(communityId: string, userId: UserId): Promise<"owner">;
  revokeVendorClaimMemberships(transaction: unknown, userId: UserId, vendorId: string): Promise<void>;
}

export interface OrganizationsPort {
  submitClaim(
    userId: UserId,
    body: { readonly vendor_id?: unknown; readonly organization_name?: unknown; readonly evidence_url?: unknown; readonly evidence_note?: unknown },
  ): Promise<VendorClaimRecord>;
  ownClaims(userId: UserId): Promise<{ readonly claims: readonly VendorClaimRecord[] }>;
  reviewQueue(userId: UserId, status: unknown): Promise<{ readonly claims: readonly VendorClaimRecord[] }>;
  verifyClaim(userId: UserId, id: string, note: unknown): Promise<VendorClaimRecord>;
  revokeClaim(userId: UserId, id: string, note: unknown): Promise<VendorClaimRecord>;
  claimCommunityOwner(
    userId: UserId,
    communityId: string,
  ): Promise<{
    readonly role: "owner";
    readonly community_id: string;
    readonly user_id: UserId;
    readonly vendor_id: string;
  }>;
}

export type { VendorClaimStatus } from "../domain/organizations.ts";
