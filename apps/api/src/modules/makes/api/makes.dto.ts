import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow, IsOptional, IsString } from "class-validator";

export class MakesListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() machine_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() material_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tag?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() model_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sort?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() limit?: string;
}

export class MakesMineQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() limit?: string;
}

export class MakeCommentsQueryDto extends MakesMineQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() sort?: string;
}

export class MakeCreateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() model_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() machine_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() material_ids?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() caption?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() printability_rating?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() geometry_quality_rating?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() surface_quality_rating?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() issue_tags?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() print_settings?: string;
}

export class MakeCommentDto {
  @ApiPropertyOptional({ type: String, maxLength: 4000 }) @Allow() body?: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) @Allow() parent_id?: string | null;
}

export class MakeReportDto {
  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true }) @Allow() reason?: string | null;
}

export class MakeAvatarConfigDto {
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
export class MakeAvatarSnapshotsDto {
  @ApiProperty({ type: String, nullable: true }) declare left: string | null;
  @ApiProperty({ type: String, nullable: true }) declare right: string | null;
  @ApiProperty({ type: String, nullable: true }) declare front: string | null;
}
export class MakeAuthorDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare username: string;
  @ApiProperty({ type: String, nullable: true }) declare display_name: string | null;
  @ApiProperty({ type: () => MakeAvatarConfigDto, nullable: true }) declare avatar_config: MakeAvatarConfigDto | null;
  @ApiProperty({ type: () => MakeAvatarSnapshotsDto, nullable: true }) declare avatar_snapshots: MakeAvatarSnapshotsDto | null;
}
export class MakeSummaryDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare model_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare model_title: string | null;
  @ApiProperty({ type: () => MakeAuthorDto }) declare author: MakeAuthorDto;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare machine_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare machine_model: string | null;
  @ApiProperty({ type: [String], format: "uuid" }) declare material_ids: string[];
  @ApiProperty({ type: String, nullable: true }) declare caption: string | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5 }) declare printability_rating: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5 }) declare geometry_quality_rating: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5 }) declare surface_quality_rating: number | null;
  @ApiProperty({ type: [String] }) declare issue_tags: string[];
  @ApiProperty({ enum: ["draft", "pending", "published", "hidden"] }) declare status: string;
  @ApiProperty({ type: String, nullable: true }) declare cover_photo_s3_key: string | null;
  @ApiProperty({ type: Number }) declare likes_count: number;
  @ApiProperty({ type: Number }) declare comments_count: number;
  @ApiProperty({ type: Number }) declare reposts_count: number;
  @ApiProperty({ type: Number }) declare views_count: number;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
}
export class MakePageResponseDto {
  @ApiProperty({ type: [MakeSummaryDto] }) declare items: MakeSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
export class MakePhotoDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: Number }) declare position: number;
  @ApiProperty({ type: Boolean }) declare is_cover: boolean;
  @ApiProperty({ type: String }) declare moderation_status: string;
}
export class MakePrintSettingsDto {
  @ApiPropertyOptional({ type: Number }) declare layer_height_mm?: number;
  @ApiPropertyOptional({ type: Number }) declare nozzle_temp_c?: number;
  @ApiPropertyOptional({ type: Number }) declare bed_temp_c?: number;
  @ApiPropertyOptional({ type: Number }) declare infill_percent?: number;
  @ApiPropertyOptional({ type: Boolean }) declare supports?: boolean;
  @ApiPropertyOptional({ type: String }) declare filament?: string;
  @ApiPropertyOptional({ type: String }) declare printer?: string;
}
export class MakeMaterialDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare name: string;
}
export class MakeDetailResponseDto extends MakeSummaryDto {
  @ApiProperty({ type: String, nullable: true }) declare notes: string | null;
  @ApiProperty({ type: () => MakePrintSettingsDto }) declare print_settings: MakePrintSettingsDto;
  @ApiProperty({ type: [MakeMaterialDto] }) declare materials: MakeMaterialDto[];
  @ApiProperty({ type: [MakePhotoDto] }) declare photos: MakePhotoDto[];
  @ApiProperty({ type: [MakeSummaryDto] }) declare more_prints_of_model: MakeSummaryDto[];
  @ApiProperty({ type: [MakeSummaryDto] }) declare same_material_prints: MakeSummaryDto[];
}
export class MakePhotoUploadOutcomeDto {
  @ApiProperty({ type: String }) declare filename: string;
  @ApiProperty({ enum: ["ok", "error"] }) declare status: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare id?: string;
  @ApiPropertyOptional({ type: Number }) declare position?: number;
  @ApiPropertyOptional({ type: Boolean }) declare is_cover?: boolean;
  @ApiPropertyOptional({ type: String }) declare moderation_status?: string;
  @ApiPropertyOptional({ type: String }) declare error?: string;
}
export class MakeCreateResponseDto extends MakeSummaryDto {
  @ApiProperty({ type: [MakePhotoUploadOutcomeDto] }) declare photos: MakePhotoUploadOutcomeDto[];
}
export class MakeCommentResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare user_id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare parent_id: string | null;
  @ApiProperty({ type: String }) declare body: string;
  @ApiProperty({ type: Number }) declare votes_up: number;
  @ApiProperty({ type: Number }) declare votes_down: number;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
}
export class MakeCommentsResponseDto {
  @ApiProperty({ type: [MakeCommentResponseDto] }) declare items: MakeCommentResponseDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
export class MakeCounterResponseDto {
  @ApiProperty({ type: Number }) declare reposts_count: number;
}
export class MakeViewsResponseDto {
  @ApiProperty({ type: Number }) declare views_count: number;
}
export class MakeVoteResponseDto {
  @ApiProperty({ type: Boolean }) declare liked: boolean;
  @ApiProperty({ type: Number }) declare likes_count: number;
}
export class MakeReportResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare make_id: string;
  @ApiProperty({ enum: ["draft", "pending", "published", "hidden"] }) declare make_status: string;
}
export class MakeLeaderboardItemDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare user_id: string;
  @ApiProperty({ type: String }) declare username: string;
  @ApiProperty({ type: String, nullable: true }) declare display_name: string | null;
  @ApiProperty({ type: String, nullable: true }) declare avatar_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare photo_s3_key: string | null;
  @ApiProperty({ type: String, nullable: true }) declare caption: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare machine_id: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare printability_rating: number | null;
  @ApiProperty({ type: Number }) declare likes_count: number;
  @ApiProperty({ type: Number }) declare comments_count: number;
  @ApiProperty({ type: Number }) declare reposts_count: number;
  @ApiProperty({ type: Number }) declare views_count: number;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: () => MakeAvatarConfigDto, nullable: true }) declare avatar_config: MakeAvatarConfigDto | null;
  @ApiProperty({ type: () => MakeAvatarSnapshotsDto, nullable: true }) declare avatar_snapshots: MakeAvatarSnapshotsDto | null;
}
export class MakeLeaderboardResponseDto {
  @ApiProperty({ type: [MakeLeaderboardItemDto] }) declare items: MakeLeaderboardItemDto[];
}

export class MakeLeaderboardQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() limit?: string;
}
