import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import { MAKER_PROCESSES, MAKER_SERVICE_MODES, type MakerProcess, type MakerServiceMode } from "../domain/maker-profile.ts";

export class MakersFeedQueryDto {
  @ApiPropertyOptional() @Allow() declare cursor?: string;
  @ApiPropertyOptional() @Allow() declare limit?: string;
}

export class MakerBuildVolumeDto {
  @ApiProperty({ type: Number }) declare x: number;
  @ApiProperty({ type: Number }) declare y: number;
  @ApiProperty({ type: Number }) declare z: number;
}

export class MakerProfileInputDto {
  @ApiPropertyOptional({ default: true }) @Allow() declare active?: boolean;
  @ApiProperty({ enum: MAKER_SERVICE_MODES }) @Allow() declare service_mode: MakerServiceMode;
  @ApiPropertyOptional({ type: Number, minimum: -90, maximum: 90, nullable: true }) @Allow() declare lat?: number | null;
  @ApiPropertyOptional({ type: Number, minimum: -180, maximum: 180, nullable: true }) @Allow() declare lng?: number | null;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 3000, nullable: true }) @Allow() declare radius_km?: number | null;
  @ApiPropertyOptional({ type: [String], maxItems: 30 }) @Allow() declare service_cities?: string[];
  @ApiProperty() @Allow() declare region_label: string;
  @ApiPropertyOptional({ enum: MAKER_PROCESSES, isArray: true }) @Allow() declare processes?: MakerProcess[];
  @ApiPropertyOptional({ type: [String], format: "uuid" }) @Allow() declare material_type_ids?: string[];
  @ApiPropertyOptional({ type: () => MakerBuildVolumeDto, nullable: true }) @Allow() declare max_build_volume_mm?: MakerBuildVolumeDto | null;
  @ApiPropertyOptional({ type: Number, minimum: 0, nullable: true }) @Allow() declare min_layer_height_mm?: number | null;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 100000, nullable: true }) @Allow() declare capacity_per_week?: number | null;
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 365, nullable: true }) @Allow() declare sla_days?: number | null;
}

export class MakerProfileDto {
  @ApiProperty({ type: Boolean }) declare active: boolean;
  @ApiProperty({ enum: MAKER_SERVICE_MODES }) declare service_mode: MakerServiceMode;
  @ApiProperty({ type: Number, nullable: true }) declare lat: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare lng: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare radius_km: number | null;
  @ApiProperty({ type: [String] }) declare service_cities: string[];
  @ApiProperty({ type: String }) declare region_label: string;
  @ApiProperty({ enum: MAKER_PROCESSES, isArray: true }) declare processes: MakerProcess[];
  @ApiProperty({ type: [String], format: "uuid" }) declare material_type_ids: string[];
  @ApiProperty({ type: () => MakerBuildVolumeDto, nullable: true }) declare max_build_volume_mm: MakerBuildVolumeDto | null;
  @ApiProperty({ type: Number, nullable: true }) declare min_layer_height_mm: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare capacity_per_week: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare sla_days: number | null;
  @ApiProperty({ type: Date, format: "date-time" }) declare updated_at: string;
}

export class MakerProfileResponseDto {
  @ApiProperty({ type: () => MakerProfileDto }) declare maker_profile: MakerProfileDto;
}

export class MakersNearbyQueryDto {
  @ApiProperty() @Allow() declare lat: string;
  @ApiProperty() @Allow() declare lng: string;
  @ApiProperty() @Allow() declare radius_km: string;
  @ApiPropertyOptional({ enum: MAKER_PROCESSES }) @Allow() declare process?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() declare material_type_id?: string;
  @ApiPropertyOptional() @Allow() declare limit?: string;
}

export class NearbyMakerDto {
  @ApiProperty({ type: String, format: "uuid" }) declare user_id: string;
  @ApiProperty({ type: String }) declare username: string;
  @ApiProperty({ type: String, nullable: true }) declare display_name: string | null;
  @ApiProperty({ type: String }) declare region_label: string;
  @ApiProperty({ enum: MAKER_SERVICE_MODES }) declare service_mode: MakerServiceMode;
  @ApiProperty({ enum: MAKER_PROCESSES, isArray: true }) declare processes: MakerProcess[];
  @ApiProperty({ type: Number, nullable: true }) declare sla_days: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare capacity_per_week: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare distance_km: number | null;
}

export class NearbyMakersResponseDto {
  @ApiProperty({ type: [NearbyMakerDto] }) declare makers: NearbyMakerDto[];
}

export class MakerFeedAvatarConfigDto {
  @ApiProperty({ type: String }) declare color: string;
  @ApiProperty({ type: String }) declare texture: string;
  @ApiProperty({ type: String }) declare pose: string;
  @ApiProperty({ type: String }) declare outfit: string;
  @ApiProperty({ type: String }) declare hat: string;
  @ApiProperty({ type: String }) declare eyes: string;
  @ApiProperty({ type: String }) declare beard: string;
  @ApiProperty({ type: String }) declare arms: string;
  @ApiProperty({ type: String }) declare accessory: string;
  @ApiProperty({ type: String }) declare back: string;
}
export class MakerFeedAvatarSnapshotsDto {
  @ApiProperty({ type: String, nullable: true }) declare left: string | null;
  @ApiProperty({ type: String, nullable: true }) declare right: string | null;
  @ApiProperty({ type: String, nullable: true }) declare front: string | null;
}
export class MakerFeedAuthorDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare username: string;
  @ApiProperty({ type: String, nullable: true }) declare display_name: string | null;
  @ApiProperty({ type: () => MakerFeedAvatarConfigDto, nullable: true }) declare avatar_config: MakerFeedAvatarConfigDto | null;
  @ApiProperty({ type: () => MakerFeedAvatarSnapshotsDto, nullable: true }) declare avatar_snapshots: MakerFeedAvatarSnapshotsDto | null;
}
export class MakerFeedMakeDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare model_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare model_title: string | null;
  @ApiProperty({ type: () => MakerFeedAuthorDto }) declare author: MakerFeedAuthorDto;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare machine_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare machine_model: string | null;
  @ApiProperty({ type: [String], format: "uuid" }) declare material_ids: string[];
  @ApiProperty({ type: String, nullable: true }) declare caption: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare printability_rating: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare geometry_quality_rating: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare surface_quality_rating: number | null;
  @ApiProperty({ type: [String] }) declare issue_tags: string[];
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: String, nullable: true }) declare cover_photo_s3_key: string | null;
  @ApiProperty({ type: Number }) declare likes_count: number;
  @ApiProperty({ type: Number }) declare comments_count: number;
  @ApiProperty({ type: Number }) declare reposts_count: number;
  @ApiProperty({ type: Number }) declare views_count: number;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
}
export class MakerFeedResponseDto {
  @ApiProperty({ type: [MakerFeedMakeDto] }) declare items: MakerFeedMakeDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
