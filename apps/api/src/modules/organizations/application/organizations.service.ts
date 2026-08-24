import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import {
  cleanOptionalString,
  EVIDENCE_NOTE_MAX_LENGTH,
  EVIDENCE_URL_MAX_LENGTH,
  isUuid,
  isVendorClaimStatus,
  ORGANIZATION_NAME_MAX_LENGTH,
  REVIEW_NOTE_MAX_LENGTH,
} from "../domain/organizations.ts";
import { OrganizationsRepository } from "../infrastructure/organizations.repository.ts";
import { ORGANIZATIONS_EXTERNAL_PORT, type OrganizationsExternalPort, type OrganizationsPort, type VendorClaimRecord } from "../public/index.ts";

@Injectable()
export class OrganizationsService implements OrganizationsPort {
  constructor(
    @Inject(OrganizationsRepository) private readonly repository: OrganizationsRepository,
    @Inject(ORGANIZATIONS_EXTERNAL_PORT) private readonly external: OrganizationsExternalPort,
  ) {}

  async submitClaim(
    userId: UserId,
    body: { readonly vendor_id?: unknown; readonly organization_name?: unknown; readonly evidence_url?: unknown; readonly evidence_note?: unknown },
  ): Promise<VendorClaimRecord> {
    const vendorId = body.vendor_id;
    if (typeof vendorId !== "string" || !isUuid(vendorId)) throw new UnprocessableEntityException();
    const organizationName = cleanOptionalString(body.organization_name, ORGANIZATION_NAME_MAX_LENGTH);
    if (organizationName === null) throw new UnprocessableEntityException();
    const evidenceUrl = cleanOptionalString(body.evidence_url, EVIDENCE_URL_MAX_LENGTH);
    const evidenceNote = cleanOptionalString(body.evidence_note, EVIDENCE_NOTE_MAX_LENGTH);
    if (evidenceUrl === null && evidenceNote === null) throw new UnprocessableEntityException();
    if (!(await this.external.vendorExists(vendorId))) throw new UnprocessableEntityException();

    const claim = await this.repository.submit({
      vendorId,
      claimantUserId: userId,
      organizationName,
      evidenceUrl,
      evidenceNote,
    });
    if (claim === null) throw new ConflictException();
    return claim;
  }

  async ownClaims(userId: UserId): Promise<{ readonly claims: readonly VendorClaimRecord[] }> {
    return { claims: await this.repository.claimsForUser(userId) };
  }

  async reviewQueue(userId: UserId, status: unknown): Promise<{ readonly claims: readonly VendorClaimRecord[] }> {
    await this.requireStaff(userId);
    if (status !== undefined && !isVendorClaimStatus(status)) throw new UnprocessableEntityException();
    return { claims: await this.repository.claims(status) };
  }

  async verifyClaim(userId: UserId, id: string, note: unknown): Promise<VendorClaimRecord> {
    await this.requireStaff(userId);
    if (!isUuid(id)) throw new NotFoundException();
    const result = await this.repository.verify(id, userId, cleanOptionalString(note, REVIEW_NOTE_MAX_LENGTH));
    if (result.kind === "not_found") throw new NotFoundException();
    if (result.kind === "not_pending") throw new ConflictException();
    return result.claim;
  }

  async revokeClaim(userId: UserId, id: string, note: unknown): Promise<VendorClaimRecord> {
    await this.requireStaff(userId);
    if (!isUuid(id)) throw new NotFoundException();
    const normalizedNote = cleanOptionalString(note, REVIEW_NOTE_MAX_LENGTH);
    if (normalizedNote === null) throw new UnprocessableEntityException();
    const result = await this.repository.revoke(id, userId, normalizedNote, (transaction, claimantId, vendorId) =>
      this.external.revokeVendorClaimMemberships(transaction, claimantId, vendorId),
    );
    if (result.kind === "not_found") throw new NotFoundException();
    if (result.kind === "already_revoked") throw new ConflictException();
    return result.claim;
  }

  async claimCommunityOwner(userId: UserId, communityId: string) {
    if (!isUuid(communityId)) throw new NotFoundException();
    const community = await this.external.activeCommunitySubject(communityId);
    if (community === null) throw new NotFoundException();
    if (community.kind !== "machine" && community.kind !== "vendor") {
      throw new UnprocessableEntityException();
    }

    let vendorId: string | null = null;
    if (community.kind === "vendor" && community.subjectType === "vendor" && community.subjectId !== null) {
      vendorId = community.subjectId;
    } else if (community.kind === "machine" && community.subjectType === "machine" && community.subjectId !== null) {
      vendorId = await this.external.machineVendorId(community.subjectId);
    }
    if (vendorId === null) throw new UnprocessableEntityException();
    if (!(await this.repository.isVerifiedHead(vendorId, userId))) throw new ForbiddenException();
    const currentOwner = await this.external.currentCommunityOwner(communityId);
    if (currentOwner !== null && currentOwner !== userId) throw new ConflictException();
    const role = await this.external.grantVendorClaimOwner(communityId, userId);
    return { role, community_id: communityId, user_id: userId, vendor_id: vendorId };
  }

  private async requireStaff(userId: UserId): Promise<void> {
    if (!(await this.external.isStaff(userId))) throw new ForbiddenException();
  }
}
