import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import { FEED_EVENT_TYPES, FEED_POST_TYPES, FEED_SCOPES, type FeedVoteValue } from "../domain/feed.ts";

export class FeedListQueryDto {
  @ApiPropertyOptional() @Allow() declare readonly scope?: string;
  @ApiPropertyOptional() @Allow() declare readonly sort?: string;
  @ApiPropertyOptional() @Allow() declare readonly window?: string;
  @ApiPropertyOptional() @Allow() declare readonly cursor?: string;
  @ApiPropertyOptional() @Allow() declare readonly limit?: string;
  @ApiPropertyOptional() @Allow() declare readonly author?: string;
}

export class FeedPostBodyDto {
  @ApiPropertyOptional({ enum: FEED_POST_TYPES }) @Allow() declare readonly type?: string;
  @ApiPropertyOptional({ maxLength: 300 }) @Allow() declare readonly title?: string;
  @ApiPropertyOptional() @Allow() declare readonly body?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() declare readonly model_id?: string;
  @ApiPropertyOptional() @Allow() declare readonly media_s3_key?: string;
  @ApiPropertyOptional() @Allow() declare readonly poster_s3_key?: string;
  @ApiPropertyOptional({ type: String, format: "uri" }) @Allow() declare readonly gitverse_url?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() declare readonly community_id?: string;
  @ApiPropertyOptional({ type: String, format: "uri" }) @Allow() declare readonly source_url?: string;
  @ApiPropertyOptional() @Allow() declare readonly source_fingerprint?: string;
  @ApiPropertyOptional() @Allow() declare readonly ingest_provider?: string;
  @ApiPropertyOptional() @Allow() declare readonly ingest_model?: string;
  @ApiPropertyOptional() @Allow() declare readonly ingest_prompt_version?: string;
  @ApiPropertyOptional({ enum: ["draft", "publish"] }) @Allow() declare readonly mode?: string;
}

export class FeedPatchDto {
  @ApiPropertyOptional({ maxLength: 300 }) @Allow() declare readonly title?: string;
  @ApiPropertyOptional() @Allow() declare readonly body?: string;
}

export class FeedCommentsQueryDto {
  @ApiPropertyOptional() @Allow() declare readonly sort?: string;
  @ApiPropertyOptional() @Allow() declare readonly cursor?: string;
  @ApiPropertyOptional() @Allow() declare readonly limit?: string;
}

export class FeedCommentBodyDto {
  @ApiPropertyOptional({ maxLength: 4000 }) @Allow() declare readonly body?: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) @Allow() declare readonly parent_id?: string | null;
}

export class FeedVoteBodyDto {
  @ApiPropertyOptional({ enum: [-1, 0, 1] }) @Allow() declare readonly value?: FeedVoteValue;
}

export class FeedEventPropsDto {
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare readonly post_id?: string;
  @ApiPropertyOptional({ type: String }) declare readonly subject_type?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare readonly subject_id?: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare readonly community_id?: string | null;
  @ApiPropertyOptional({ type: Number }) declare readonly value?: number;
  @ApiPropertyOptional({ type: Number }) declare readonly duration_ms?: number;
  @ApiPropertyOptional({ type: Number }) declare readonly position?: number;
  @ApiPropertyOptional({ type: String, format: "uri" }) declare readonly target_url?: string;
}

export class FeedEventBodyDto {
  @ApiPropertyOptional({ enum: FEED_EVENT_TYPES }) @Allow() declare readonly event_name?: string;
  @ApiPropertyOptional({ type: () => FeedEventPropsDto }) @Allow() declare readonly props?: FeedEventPropsDto;
}

export class FeedAuthorDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare username: string;
  @ApiProperty({ type: String, nullable: true }) declare display_name: string | null;
  @ApiProperty({ type: String, nullable: true }) declare avatar_url: string | null;
}
export class FeedGitverseMetaDto {
  @ApiProperty({ type: String }) declare owner: string;
  @ApiProperty({ type: String }) declare name: string;
  @ApiProperty({ type: String, nullable: true }) declare avatar_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare description: string | null;
  @ApiProperty({ type: Number }) declare stars: number;
  @ApiProperty({ type: String, nullable: true }) declare language: string | null;
}
export class FeedPostResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare author_id: string;
  @ApiProperty({ type: String, nullable: true }) declare co_author_agent_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare community_id: string | null;
  @ApiProperty({ enum: FEED_POST_TYPES }) declare type: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String, nullable: true }) declare body: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare model_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare media_s3_key: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare make_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare poster_s3_key: string | null;
  @ApiProperty({ type: String, nullable: true }) declare gitverse_url: string | null;
  @ApiProperty({ type: () => FeedGitverseMetaDto, nullable: true }) declare gitverse_meta: FeedGitverseMetaDto | null;
  @ApiProperty({ type: Number }) declare votes_up: number;
  @ApiProperty({ type: Number }) declare votes_down: number;
  @ApiProperty({ type: Number }) declare comments_count: number;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Boolean }) declare is_edited: boolean;
  @ApiProperty({ type: Date, format: "date-time", nullable: true }) declare edited_at: Date | null;
  @ApiProperty({ type: String, nullable: true }) declare source_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare source_fingerprint: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_provider: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_model: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_prompt_version: string | null;
  @ApiProperty({ type: () => FeedAuthorDto, nullable: true }) declare author: FeedAuthorDto | null;
}
export class FeedPostEnvelopeDto {
  @ApiProperty({ type: () => FeedPostResponseDto }) declare post: FeedPostResponseDto;
}
export class FeedPageResponseDto {
  @ApiProperty({ type: [FeedPostResponseDto] }) declare items: FeedPostResponseDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
  @ApiProperty({ enum: FEED_SCOPES }) declare scope: string;
  @ApiProperty({ type: Boolean }) declare recommendation_fallback: boolean;
}
export class FeedCommentResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare user_id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare parent_id: string | null;
  @ApiProperty({ type: String }) declare body: string;
  @ApiProperty({ type: Number }) declare votes_up: number;
  @ApiProperty({ type: Number }) declare votes_down: number;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: () => FeedAuthorDto, nullable: true }) declare author: FeedAuthorDto | null;
}
export class FeedCommentsResponseDto {
  @ApiProperty({ type: [FeedCommentResponseDto] }) declare comments: FeedCommentResponseDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
export class FeedCommentEnvelopeDto {
  @ApiProperty({ type: () => FeedCommentResponseDto }) declare comment: FeedCommentResponseDto;
}
export class FeedOkDto {
  @ApiProperty({ enum: [true] }) declare ok: true;
}
export class FeedVoteResponseDto {
  @ApiProperty({ type: Number }) declare votes_up: number;
  @ApiProperty({ type: Number }) declare votes_down: number;
  @ApiProperty({ type: Number }) declare votes_up_weighted: number;
  @ApiProperty({ type: Number }) declare votes_down_weighted: number;
  @ApiProperty({ enum: [-1, 0, 1] }) declare my_vote: FeedVoteValue;
}
export class FeedSavedResponseDto {
  @ApiProperty({ type: Boolean }) declare saved: boolean;
}
export class FeedMediaUploadResponseDto {
  @ApiProperty({ type: String }) declare s3_key: string;
  @ApiProperty({ type: String, nullable: true }) declare url: string | null;
  @ApiProperty({ enum: ["image", "video"] }) declare kind: string;
}
export class FeedImageUploadResponseDto {
  @ApiProperty({ type: String }) declare url: string;
}

export class FeedGitverseQueryDto {
  @ApiPropertyOptional() @Allow() declare readonly url?: string;
}
