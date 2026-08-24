import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow, IsOptional, IsString } from "class-validator";
import { IDEA_CATEGORIES, IDEA_ORIGIN_SOURCES, IDEA_STATUSES, IDEA_TYPES, type IdeaCategory, type IdeaOriginSource, type IdeaStatus, type IdeaType } from "../domain/ideas.ts";

export class IdeasListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() tab?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() limit?: string;
}

export class IdeasMineQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() limit?: string;
}

export class IdeasTopQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() limit?: string;
}

export class IdeasSimilarQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
}

export class IdeaOriginDto {
  @ApiProperty({ enum: IDEA_ORIGIN_SOURCES }) declare source: IdeaOriginSource;
  @ApiPropertyOptional({ type: String }) declare ref_id?: string;
  @ApiPropertyOptional({ type: String, format: "uri" }) declare ref_url?: string;
  @ApiPropertyOptional({ type: String }) declare query?: string;
}

export class CreateIdeaDto {
  @ApiPropertyOptional({ type: String, maxLength: 120 }) @Allow() title?: string;
  @ApiPropertyOptional({ type: String, maxLength: 20_000 }) @Allow() body?: string;
  @ApiPropertyOptional({ enum: IDEA_CATEGORIES }) @Allow() category?: IdeaCategory;
  @ApiPropertyOptional({ enum: IDEA_TYPES }) @Allow() type?: IdeaType;
  @ApiPropertyOptional({ type: () => IdeaOriginDto }) @Allow() origin?: IdeaOriginDto;
  @ApiPropertyOptional() @Allow() ai_assisted?: boolean;
}

export class EnrichIdeaDto {
  @ApiPropertyOptional({ type: String, maxLength: 4_000 }) @Allow() free_text?: string;
}

export class IdeaCommentDto {
  @ApiPropertyOptional({ type: String, maxLength: 5_000 }) @Allow() body?: string;
}

export class IdeaStatusDto {
  @ApiPropertyOptional({ enum: IDEA_STATUSES }) @Allow() status?: IdeaStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) @Allow() decline_reason?: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) @Allow() canonical_id?: string | null;
}

export class ModerateIdeaDto {
  @ApiPropertyOptional({ enum: ["hide", "remove", "restore"] }) @Allow() action?: "hide" | "remove" | "restore";
  @ApiPropertyOptional({ type: String, nullable: true }) @Allow() reason?: string | null;
}

export class IdeaDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare author_id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String }) declare body: string;
  @ApiProperty({ enum: IDEA_CATEGORIES }) declare category: IdeaCategory;
  @ApiProperty({ enum: IDEA_TYPES }) declare type: IdeaType;
  @ApiProperty({ enum: IDEA_STATUSES }) declare status: IdeaStatus;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare canonical_id: string | null;
  @ApiProperty({ type: Number }) declare vote_count: number;
  @ApiProperty({ type: String, nullable: true }) declare decline_reason: string | null;
  @ApiProperty({ type: () => IdeaOriginDto, nullable: true }) declare origin: IdeaOriginDto | null;
  @ApiProperty({ type: Boolean }) declare ai_assisted: boolean;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Date, format: "date-time" }) declare last_activity_at: Date;
}

export class IdeaCommentResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare idea_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare user_id: string;
  @ApiProperty({ type: String }) declare body: string;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
}

export class IdeasPageDto {
  @ApiProperty({ type: [IdeaDto] }) declare items: IdeaDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}

export class IdeaDetailDto extends IdeaDto {
  @ApiProperty({ type: Boolean }) declare viewer_has_voted: boolean;
  @ApiProperty({ type: [IdeaCommentResponseDto] }) declare comments: IdeaCommentResponseDto[];
}

export class IdeaCreateResponseDto extends IdeaDto {
  @ApiProperty({ type: Number }) declare quota_remaining: number;
}

export class IdeaTopItemDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ enum: IDEA_CATEGORIES }) declare category: IdeaCategory;
  @ApiProperty({ enum: IDEA_STATUSES }) declare status: IdeaStatus;
  @ApiProperty({ type: Number }) declare vote_count: number;
  @ApiProperty({ type: Number }) declare trend_score: number;
  @ApiProperty({ type: String, format: "uri" }) declare url: string;
}

export class IdeaTopResponseDto {
  @ApiProperty({ type: [IdeaTopItemDto] }) declare items: IdeaTopItemDto[];
}
export class IdeaSimilarItemDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare title: string;
}
export class IdeaSimilarResponseDto {
  @ApiProperty({ type: [IdeaSimilarItemDto] }) declare items: IdeaSimilarItemDto[];
}
export class IdeaCommentsResponseDto {
  @ApiProperty({ type: [IdeaCommentResponseDto] }) declare items: IdeaCommentResponseDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
export class IdeaVoteResponseDto {
  @ApiProperty({ type: Number }) declare vote_count: number;
  @ApiProperty({ type: Boolean }) declare viewer_has_voted: boolean;
}
export class IdeaStatusResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ enum: IDEA_STATUSES }) declare status: IdeaStatus;
  @ApiProperty({ type: String, nullable: true }) declare decline_reason: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare canonical_id: string | null;
}
export class IdeaModerationResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ enum: IDEA_STATUSES }) declare status: IdeaStatus;
}
export class IdeaEnrichmentResponseDto {
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String }) declare body: string;
  @ApiProperty({ enum: IDEA_CATEGORIES }) declare category: IdeaCategory;
}
