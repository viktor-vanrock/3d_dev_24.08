import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";

export class MasterProfilePatchDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120 })
  @Allow()
  declare readonly headline?: unknown;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @Allow()
  declare readonly description?: unknown;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 80 })
  @Allow()
  declare readonly city?: unknown;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 160 })
  @Allow()
  declare readonly slogan?: unknown;
}

export class MasterProfileResponseDto {
  @ApiProperty({ type: String, nullable: true }) declare headline: string | null;
  @ApiProperty({ type: String, nullable: true }) declare description: string | null;
  @ApiProperty({ type: String, nullable: true }) declare city: string | null;
  @ApiProperty({ type: String, nullable: true }) declare slogan: string | null;
}

export class MasterStateResponseDto {
  @ApiProperty({ type: Boolean }) declare is_master: boolean;
  @ApiProperty({ type: MasterProfileResponseDto }) declare master_profile: MasterProfileResponseDto;
}

export class PublicMasterDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare username: string;
  @ApiProperty({ type: String, nullable: true }) declare display_name: string | null;
  @ApiProperty({ type: String, nullable: true }) declare avatar_url: string | null;
  @ApiProperty({ type: MasterProfileResponseDto }) declare master_profile: MasterProfileResponseDto;
}

export class PublicMasterResponseDto {
  @ApiProperty({ type: PublicMasterDto }) declare master: PublicMasterDto;
}
