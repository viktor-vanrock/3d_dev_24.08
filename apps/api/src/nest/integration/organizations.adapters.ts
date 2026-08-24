import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { CatalogModule } from "../../modules/catalog/catalog.module.ts";
import { CATALOG_READ_PORT, type CatalogReadPort } from "../../modules/catalog/public/index.ts";
import { CommunityModule } from "../../modules/community/community.module.ts";
import { COMMUNITY_ORGANIZATION_PORT, type CommunityOrganizationPort } from "../../modules/community/public/index.ts";
import { ORGANIZATIONS_EXTERNAL_PORT, type OrganizationsExternalPort } from "../../modules/organizations/public/index.ts";
import { ProfileModule } from "../../modules/profile/profile.module.ts";
import { PROFILE_ADMIN_PORT, type ProfileAdminPort } from "../../modules/profile/public/index.ts";

@Injectable()
export class OrganizationsExternalAdapter implements OrganizationsExternalPort {
  constructor(
    @Inject(PROFILE_ADMIN_PORT) private readonly profile: ProfileAdminPort,
    @Inject(CATALOG_READ_PORT) private readonly catalog: CatalogReadPort,
    @Inject(COMMUNITY_ORGANIZATION_PORT) private readonly community: CommunityOrganizationPort,
  ) {}

  isStaff(userId: Parameters<OrganizationsExternalPort["isStaff"]>[0]) {
    return this.profile.isStaff(userId);
  }
  vendorExists(vendorId: string) {
    return this.catalog.vendorExists(vendorId);
  }
  machineVendorId(machineId: string) {
    return this.catalog.machineVendorId(machineId);
  }
  activeCommunitySubject(communityId: string) {
    return this.community.activeCatalogSubject(communityId);
  }
  currentCommunityOwner(communityId: string) {
    return this.community.currentOwner(communityId);
  }
  grantVendorClaimOwner(communityId: string, userId: Parameters<OrganizationsExternalPort["grantVendorClaimOwner"]>[1]) {
    return this.community.grantVendorClaimOwner(communityId, userId);
  }
  async revokeVendorClaimMemberships(transaction: unknown, userId: Parameters<OrganizationsExternalPort["revokeVendorClaimMemberships"]>[1], vendorId: string): Promise<void> {
    const machineIds = await this.catalog.machineIdsForVendor(vendorId);
    await this.community.revokeVendorClaimMemberships(transaction, userId, vendorId, machineIds);
  }
}

@Global()
@Module({
  imports: [ProfileModule, CatalogModule, CommunityModule],
  providers: [OrganizationsExternalAdapter, { provide: ORGANIZATIONS_EXTERNAL_PORT, useExisting: OrganizationsExternalAdapter }],
  exports: [ORGANIZATIONS_EXTERNAL_PORT],
})
export class OrganizationsIntegrationModule {}
