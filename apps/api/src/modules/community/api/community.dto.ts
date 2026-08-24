import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { COMMUNITY_ROLES, POST_KINDS, SUBSCRIBE_SOURCES, THREAD_TYPES, type CommunityRole, type PostKind, type SubscribeSource, type ThreadType } from "../domain/community.ts";

export class CreateCommunityDto {
  @ApiProperty() @IsString() declare name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declare slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declare description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declare visibility?: string;
  @ApiPropertyOptional({ type: [String], format: "uuid" }) @IsOptional() @IsArray() @IsUUID("4", { each: true }) declare tag_ids?: string[];
}

export class SubscriptionDto {
  @ApiPropertyOptional({ enum: SUBSCRIBE_SOURCES }) @IsOptional() @IsIn(SUBSCRIBE_SOURCES) declare source?: SubscribeSource;
}

export class RoleDto {
  @ApiProperty({ enum: COMMUNITY_ROLES }) @IsIn(COMMUNITY_ROLES) declare role: CommunityRole;
}

export class BootstrapOwnerDto {
  @ApiProperty({ type: String, format: "uuid" }) @IsUUID() declare user_id: string;
}

export class CreateThreadDto {
  @ApiProperty({ enum: THREAD_TYPES }) @IsIn(THREAD_TYPES) declare type: ThreadType;
  @ApiProperty() @IsString() declare title: string;
  @ApiProperty() @IsString() declare content: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) declare tags?: string[];
}

export class CreatePostDto {
  @ApiProperty({ enum: POST_KINDS }) @IsIn(POST_KINDS) declare kind: PostKind;
  @ApiProperty() @IsString() declare content: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @IsOptional() @IsUUID() declare parent_post_id?: string;
}

export class VoteDto {
  @ApiProperty({ enum: [-1, 0, 1] }) @IsInt() @Min(-1) @Max(1) declare value: -1 | 0 | 1;
}

export class AcceptDto {
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) @IsOptional() @IsUUID() declare post_id: string | null;
}

export class CommunityViewDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare slug: string;
  @ApiProperty({ type: String }) declare name: string;
  @ApiProperty({ type: String }) declare kind: string;
  @ApiProperty({ type: String, nullable: true }) declare subject_type: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare subject_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare description: string | null;
  @ApiProperty({ type: String, nullable: true }) declare cover_image_s3_key: string | null;
  @ApiProperty({ type: String, nullable: true }) declare cover_image_url: string | null;
  @ApiProperty({ type: String }) declare visibility: string;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare created_by: string | null;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Number }) declare member_count: number;
  @ApiProperty({ type: Number }) declare thread_count: number;
  @ApiProperty({ type: Boolean }) declare is_official: boolean;
  @ApiProperty({ enum: ["owner", "moderator", "member"], nullable: true }) declare viewer_role: CommunityRole | null;
  @ApiPropertyOptional({ type: String, format: "uri", nullable: true }) declare website: string | null;
}
export class CommunityPageDto {
  @ApiProperty({ type: [CommunityViewDto] }) declare items: CommunityViewDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
export class RelatedCommunityDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare slug: string;
  @ApiProperty({ type: String }) declare name: string;
  @ApiProperty({ type: String }) declare kind: string;
}
export class CommunityDetailDto extends CommunityViewDto {
  @ApiProperty({ type: [RelatedCommunityDto] }) declare related_communities: RelatedCommunityDto[];
}
export class CommunityRoleResponseDto {
  @ApiProperty({ enum: COMMUNITY_ROLES }) declare role: CommunityRole;
}
export class CommunityLeftResponseDto {
  @ApiProperty({ enum: [true] }) declare left: true;
}
export class BootstrapOwnerResponseDto extends CommunityRoleResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare user_id: string;
}
export class ThreadViewDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare community_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare author_id: string;
  @ApiProperty({ enum: THREAD_TYPES }) declare type: ThreadType;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String }) declare content: string;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: Boolean }) declare pinned: boolean;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare accepted_post_id: string | null;
  @ApiProperty({ type: Number }) declare votes_up: number;
  @ApiProperty({ type: Number }) declare votes_down: number;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Date, format: "date-time" }) declare updated_at: Date;
  @ApiProperty({ type: Number }) declare post_count: number;
  @ApiProperty({ type: [String] }) declare tags: string[];
}
export class ThreadPageDto {
  @ApiProperty({ type: [ThreadViewDto] }) declare items: ThreadViewDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
export class AttachmentViewDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ enum: ["photo", "model_3mf"] }) declare kind: string;
  @ApiProperty({ type: String }) declare url: string;
  @ApiProperty({ type: Number }) declare size_bytes: number;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
}
export class ResolvedModelDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String, nullable: true }) declare thumbnail_url: string | null;
}
export class PostViewDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare thread_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare author_id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare parent_post_id: string | null;
  @ApiProperty({ enum: POST_KINDS }) declare kind: PostKind;
  @ApiProperty({ type: String }) declare content: string;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: Number }) declare votes_up: number;
  @ApiProperty({ type: Number }) declare votes_down: number;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Date, format: "date-time" }) declare updated_at: Date;
  @ApiProperty({ type: Boolean }) declare is_accepted: boolean;
  @ApiProperty({ type: [AttachmentViewDto] }) declare attachments: AttachmentViewDto[];
  @ApiProperty({ type: [ResolvedModelDto] }) declare resolved_models: ResolvedModelDto[];
}
export class ThreadDetailDto {
  @ApiProperty({ type: () => ThreadViewDto }) declare thread: ThreadViewDto;
  @ApiProperty({ type: [PostViewDto] }) declare posts: PostViewDto[];
}
export class VoteResponseDto {
  @ApiProperty({ type: Number }) declare votes_up: number;
  @ApiProperty({ type: Number }) declare votes_down: number;
  @ApiProperty({ enum: [-1, 0, 1] }) declare my_vote: -1 | 0 | 1;
}
export class AttachmentEnvelopeDto {
  @ApiProperty({ type: () => AttachmentViewDto }) declare attachment: AttachmentViewDto;
}
export class AcceptedResponseDto {
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare accepted_post_id: string | null;
}
export class CommunityFeedAuthorDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare username: string;
  @ApiProperty({ type: String, nullable: true }) declare display_name: string | null;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare avatar_url: string | null;
}
export class CommunityFeedGitverseDto {
  @ApiProperty({ type: String }) declare owner: string;
  @ApiProperty({ type: String }) declare name: string;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare avatar_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare description: string | null;
  @ApiProperty({ type: Number }) declare stars: number;
  @ApiProperty({ type: String, nullable: true }) declare language: string | null;
}
export class CommunityFeedPostDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare author_id: string;
  @ApiProperty({ type: String, nullable: true }) declare co_author_agent_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare community_id: string | null;
  @ApiProperty({ type: String }) declare type: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String, nullable: true }) declare body: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare model_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare media_s3_key: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare make_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare poster_s3_key: string | null;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare gitverse_url: string | null;
  @ApiProperty({ type: () => CommunityFeedGitverseDto, nullable: true }) declare gitverse_meta: CommunityFeedGitverseDto | null;
  @ApiProperty({ type: Number }) declare votes_up: number;
  @ApiProperty({ type: Number }) declare votes_down: number;
  @ApiProperty({ type: Number }) declare comments_count: number;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Boolean }) declare is_edited: boolean;
  @ApiProperty({ type: Date, format: "date-time", nullable: true }) declare edited_at: Date | null;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare source_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare source_fingerprint: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_provider: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_model: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_prompt_version: string | null;
  @ApiProperty({ type: () => CommunityFeedAuthorDto, nullable: true }) declare author: CommunityFeedAuthorDto | null;
}
export class CommunityFeedPageDto {
  @ApiProperty({ type: [CommunityFeedPostDto] }) declare items: CommunityFeedPostDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
