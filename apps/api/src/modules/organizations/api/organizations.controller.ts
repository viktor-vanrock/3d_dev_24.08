import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { ORGANIZATIONS_PORT, type OrganizationsPort } from "../public/index.ts";
import { ReviewVendorClaimDto, SubmitVendorClaimDto, VendorClaimQueryDto } from "./organizations.dto.ts";
import { ApiOrganizationsOperation } from "./openapi.ts";
import { Permission } from "../../permissions/decorators/permission.decorator.ts";
import { User } from "../../permissions/decorators/user.decorator.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";

function userId(request: RequestWithSession): UserIdType {
  const session = request[SESSION_USER];
  if (session === undefined) throw new UnauthorizedException();
  return UserId(session.id);
}

@Controller()
@User()
export class OrganizationsController {
  constructor(@Inject(ORGANIZATIONS_PORT) private readonly organizations: OrganizationsPort) {}

  @Post("communities/:id/claim-owner")
  @HttpCode(200)
  @ApiOrganizationsOperation("Claim ownership of an official catalog community", 200, "owner")
  claimCommunityOwner(@Req() request: RequestWithSession, @Param("id") id: string) {
    return this.organizations.claimCommunityOwner(userId(request), id);
  }

  @Post("vendor-claims")
  @ApiOrganizationsOperation("Submit a vendor representation claim", 201)
  submitClaim(@Req() request: RequestWithSession, @Body() body: SubmitVendorClaimDto) {
    return this.organizations.submitClaim(userId(request), body);
  }

  @Get("vendor-claims/mine")
  @ApiOrganizationsOperation("List the current user's vendor claims", 200, "claims")
  ownClaims(@Req() request: RequestWithSession) {
    return this.organizations.ownClaims(userId(request));
  }

  @Get("vendor-claims")
  @Permission(Permissions.CATALOG_REVIEW_VENDOR_CLAIMS)
  @ApiOrganizationsOperation("List the staff vendor-claim review queue", 200, "claims")
  reviewQueue(@Req() request: RequestWithSession, @Query() query: VendorClaimQueryDto) {
    return this.organizations.reviewQueue(userId(request), query.status);
  }

  @Post("vendor-claims/:id/verify")
  @Permission(Permissions.CATALOG_REVIEW_VENDOR_CLAIMS)
  @HttpCode(200)
  @ApiOrganizationsOperation("Verify a vendor representation claim")
  verifyClaim(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: ReviewVendorClaimDto) {
    return this.organizations.verifyClaim(userId(request), id, body.note);
  }

  @Post("vendor-claims/:id/revoke")
  @Permission(Permissions.CATALOG_REVIEW_VENDOR_CLAIMS)
  @HttpCode(200)
  @ApiOrganizationsOperation("Revoke a vendor representation claim")
  revokeClaim(@Req() request: RequestWithSession, @Param("id") id: string, @Body() body: ReviewVendorClaimDto) {
    return this.organizations.revokeClaim(userId(request), id, body.note);
  }
}
