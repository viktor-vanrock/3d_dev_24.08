import { ConflictException, ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { OrganizationsRepository } from "../infrastructure/organizations.repository.ts";
import type { VendorClaimRecord } from "../public/index.ts";
import { OrganizationsService } from "./organizations.service.ts";

const USER = UserId("11111111-1111-4111-8111-111111111111");
const STAFF = UserId("22222222-2222-4222-8222-222222222222");
const VENDOR = "33333333-3333-4333-8333-333333333333";
const CLAIM = "44444444-4444-4444-8444-444444444444";
const COMMUNITY = "55555555-5555-4555-8555-555555555555";

function claim(status: VendorClaimRecord["status"] = "pending"): VendorClaimRecord {
  const now = new Date("2026-08-05T00:00:00.000Z");
  return {
    id: CLAIM,
    vendor_id: VENDOR,
    claimant_user_id: USER,
    organization_name: "Organization",
    evidence_url: "https://example.test/proof",
    evidence_note: null,
    status,
    organization_id: null,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    created_at: now,
    updated_at: now,
  };
}

function setup() {
  const repository = {
    submit: vi.fn(),
    claimsForUser: vi.fn(),
    claims: vi.fn(),
    isVerifiedHead: vi.fn(),
    verify: vi.fn(),
    revoke: vi.fn(),
  };
  const external = {
    isStaff: vi.fn(),
    vendorExists: vi.fn(),
    machineVendorId: vi.fn(),
    activeCommunitySubject: vi.fn(),
    currentCommunityOwner: vi.fn(),
    grantVendorClaimOwner: vi.fn(),
    revokeVendorClaimMemberships: vi.fn(),
  };
  const service = new OrganizationsService(repository as unknown as OrganizationsRepository, external);
  return { service, repository, external };
}

describe("OrganizationsService parity", () => {
  it("normalizes legacy claim input and treats a duplicate pending claim as conflict", async () => {
    const { service, repository, external } = setup();
    external.vendorExists.mockResolvedValue(true);
    repository.submit.mockResolvedValueOnce(claim()).mockResolvedValueOnce(null);
    const longNote = ` evidence ${"x".repeat(2_100)} `;

    await expect(
      service.submitClaim(USER, {
        vendor_id: VENDOR,
        organization_name: " Organization ",
        evidence_note: longNote,
      }),
    ).resolves.toMatchObject({ id: CLAIM });
    expect(repository.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationName: "Organization",
        evidenceNote: longNote.trim().slice(0, 2_000),
      }),
    );
    await expect(
      service.submitClaim(USER, {
        vendor_id: VENDOR,
        organization_name: "Organization",
        evidence_note: "proof",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("checks staff before review input and requires a revoke note before repository access", async () => {
    const { service, repository, external } = setup();
    external.isStaff.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(service.verifyClaim(USER, "not-a-uuid", null)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.verify).not.toHaveBeenCalled();
    await expect(service.revokeClaim(STAFF, CLAIM, "  ")).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repository.revoke).not.toHaveBeenCalled();
  });

  it("executes community cleanup through the owner port inside the repository transaction", async () => {
    const { service, repository, external } = setup();
    const transaction = { id: "transaction" };
    external.isStaff.mockResolvedValue(true);
    external.revokeVendorClaimMemberships.mockResolvedValue(undefined);
    repository.revoke.mockImplementation(async (_id: string, _staff: typeof STAFF, _note: string, revoke: Parameters<OrganizationsRepository["revoke"]>[3]) => {
      await revoke(transaction, USER, VENDOR);
      return { kind: "revoked", claim: claim("revoked") };
    });

    await expect(service.revokeClaim(STAFF, CLAIM, " revoked ")).resolves.toMatchObject({ status: "revoked" });
    expect(external.revokeVendorClaimMemberships).toHaveBeenCalledWith(transaction, USER, VENDOR);
  });

  it("conceals invalid communities and preserves verified-head and existing-owner gates", async () => {
    const { service, repository, external } = setup();
    external.activeCommunitySubject.mockResolvedValue({
      kind: "vendor",
      subjectType: "vendor",
      subjectId: VENDOR,
    });
    repository.isVerifiedHead.mockResolvedValue(true);
    external.currentCommunityOwner.mockResolvedValue(null);
    external.grantVendorClaimOwner.mockResolvedValue("owner");

    await expect(service.claimCommunityOwner(USER, COMMUNITY)).resolves.toEqual({
      role: "owner",
      community_id: COMMUNITY,
      user_id: USER,
      vendor_id: VENDOR,
    });
    external.currentCommunityOwner.mockResolvedValue(STAFF);
    await expect(service.claimCommunityOwner(USER, COMMUNITY)).rejects.toBeInstanceOf(ConflictException);
  });
});
