import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import { VENDOR_CLAIM_STATUSES, type VendorClaimStatus } from "../domain/organizations.ts";

export class SubmitVendorClaimDto {
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() vendor_id?: unknown;
  @ApiPropertyOptional({ type: String, maxLength: 200 }) @Allow() organization_name?: unknown;
  @ApiPropertyOptional({ type: String, maxLength: 500 }) @Allow() evidence_url?: unknown;
  @ApiPropertyOptional({ type: String, maxLength: 2_000 }) @Allow() evidence_note?: unknown;
}

export class VendorClaimQueryDto {
  @ApiPropertyOptional({ type: String, enum: ["pending", "verified", "revoked"] })
  @Allow()
  status?: unknown;
}

export class ReviewVendorClaimDto {
  @ApiPropertyOptional({ type: String, maxLength: 2_000 }) @Allow() note?: unknown;
}

export class VendorClaimResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare vendor_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare claimant_user_id: string;
  @ApiProperty({ type: String }) declare organization_name: string;
  @ApiProperty({ type: String, nullable: true }) declare evidence_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare evidence_note: string | null;
  @ApiProperty({ type: String, enum: VENDOR_CLAIM_STATUSES }) declare status: VendorClaimStatus;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare organization_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare reviewed_by: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare reviewed_at: Date | null;
  @ApiProperty({ type: String, nullable: true }) declare review_note: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}

export class VendorClaimsResponseDto {
  @ApiProperty({ type: [VendorClaimResponseDto] }) declare claims: readonly VendorClaimResponseDto[];
}

export class CommunityOwnerClaimResponseDto {
  @ApiProperty({ type: String, enum: ["owner"] }) declare role: "owner";
  @ApiProperty({ type: String, format: "uuid" }) declare community_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare user_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare vendor_id: string;
}
