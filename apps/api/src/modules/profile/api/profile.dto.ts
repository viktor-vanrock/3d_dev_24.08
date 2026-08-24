import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";
import { AVATAR_LAYERS, type AvatarConfig } from "../domain/profile.ts";

export class PatchProfileDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  declare readonly username?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  declare readonly display_name?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  declare readonly avatar_url?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  declare readonly bio?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  declare readonly website_url?: string | null;

  @ApiPropertyOptional({ type: () => [ProfileContactDto] })
  @IsOptional()
  declare readonly contacts?: readonly ProfileContactDto[];
}

export class ProfileContactDto {
  @ApiProperty({ type: String }) declare readonly label: string;
  @ApiProperty({ type: String, format: "uri" }) declare readonly url: string;
}

export class AvatarConfigDto {
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.color }) declare readonly color: AvatarConfig["color"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.texture }) declare readonly texture: AvatarConfig["texture"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.pose }) declare readonly pose: AvatarConfig["pose"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.outfit }) declare readonly outfit: AvatarConfig["outfit"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.hat }) declare readonly hat: AvatarConfig["hat"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.eyes }) declare readonly eyes: AvatarConfig["eyes"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.beard }) declare readonly beard: AvatarConfig["beard"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.arms }) declare readonly arms: AvatarConfig["arms"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.accessory }) declare readonly accessory: AvatarConfig["accessory"];
  @ApiProperty({ type: String, enum: AVATAR_LAYERS.back }) declare readonly back: AvatarConfig["back"];
}

export class AvatarSnapshotsDto {
  @ApiProperty({ type: String, format: "uri-reference", nullable: true }) declare readonly left: string | null;
  @ApiProperty({ type: String, format: "uri-reference", nullable: true }) declare readonly right: string | null;
  @ApiProperty({ type: String, format: "uri-reference", nullable: true }) declare readonly front: string | null;
}

export class AvatarSnapshotInputDto {
  @ApiPropertyOptional({ type: String, format: "byte" }) declare readonly left?: string;
  @ApiPropertyOptional({ type: String, format: "byte" }) declare readonly right?: string;
  @ApiPropertyOptional({ type: String, format: "byte" }) declare readonly front?: string;
}

export class PatchAvatarDto {
  @ApiProperty({ type: AvatarConfigDto })
  @IsOptional()
  declare readonly config?: AvatarConfigDto;

  @ApiPropertyOptional({
    type: AvatarSnapshotInputDto,
  })
  @IsOptional()
  declare readonly snapshots?: AvatarSnapshotInputDto;
}

export class UpdatedProfileUserDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly username: string;
  @ApiProperty({ type: String, nullable: true }) declare readonly display_name: string | null;
  @ApiProperty({ type: String, format: "uri-reference", nullable: true }) declare readonly avatar_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare readonly bio: string | null;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare readonly website_url: string | null;
  @ApiProperty({ type: [ProfileContactDto] }) declare readonly contacts: readonly ProfileContactDto[];
  @ApiProperty({ type: Boolean }) declare readonly handle_confirmed: boolean;
}

export class UpdatedProfileResponseDto {
  @ApiProperty({ type: UpdatedProfileUserDto }) declare readonly user: UpdatedProfileUserDto;
}

export class PublicProfileUserDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly username: string;
  @ApiProperty({ type: String, nullable: true }) declare readonly display_name: string | null;
  @ApiProperty({ type: String, format: "uri-reference", nullable: true }) declare readonly avatar_url: string | null;
  @ApiProperty({ type: AvatarConfigDto, nullable: true }) declare readonly avatar_config: AvatarConfigDto | null;
  @ApiProperty({ type: AvatarSnapshotsDto, nullable: true }) declare readonly avatar_snapshots: AvatarSnapshotsDto | null;
  @ApiProperty({ type: String, nullable: true }) declare readonly bio: string | null;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare readonly website_url: string | null;
  @ApiProperty({ type: [ProfileContactDto] }) declare readonly contacts: readonly ProfileContactDto[];
  @ApiProperty({ type: Number, minimum: 0 }) declare readonly models_count: number;
  @ApiProperty({ type: Number, minimum: 0 }) declare readonly project_views_count: number;
  @ApiProperty({ type: Number, minimum: 0 }) declare readonly project_downloads_count: number;
  @ApiProperty({ type: Number, minimum: 0 }) declare readonly posts_count: number;
  @ApiProperty({ type: Number, minimum: 0 }) declare readonly post_views_count: number;
  @ApiProperty({ type: Number }) declare readonly post_score: number;
  @ApiProperty({ type: Number, minimum: 0 }) declare readonly post_comments_count: number;
  @ApiProperty({ type: Number, minimum: 0 }) declare readonly followers_count: number;
  @ApiProperty({ type: Number, minimum: 0 }) declare readonly following_count: number;
  @ApiProperty({ type: Boolean }) declare readonly is_following: boolean;
  @ApiProperty({ type: [String] }) declare readonly badges: readonly string[];
  @ApiProperty({ type: Number }) declare readonly reputation_score: number;
  @ApiProperty({ type: Number }) declare readonly trust_level: number;
}

export class PublicProfileResponseDto {
  @ApiProperty({ type: PublicProfileUserDto }) declare readonly user: PublicProfileUserDto;
}

export class AvatarResponseDto {
  @ApiProperty({ type: AvatarConfigDto }) declare readonly config: AvatarConfigDto;
  @ApiProperty({ type: Number, minimum: 1 }) declare readonly revision: number;
  @ApiProperty({ type: AvatarSnapshotsDto }) declare readonly snapshots: AvatarSnapshotsDto;
}
