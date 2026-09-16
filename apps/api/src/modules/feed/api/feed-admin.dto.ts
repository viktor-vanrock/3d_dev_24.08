import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class FeedAdminQueryDto {
  @ApiPropertyOptional({ enum: ["all", "draft", "published", "hidden"] })
  @IsOptional() @IsIn(["all", "draft", "published", "hidden"])
  declare status?: "all" | "draft" | "published" | "hidden";

  @ApiPropertyOptional({ enum: ["all", "manual", "scout"] })
  @IsOptional() @IsIn(["all", "manual", "scout"])
  declare source?: "all" | "manual" | "scout";
}

export class FeedAdminCreateDto {
  @ApiProperty({ type: String, maxLength: 300 }) @IsString() @MaxLength(300) declare title: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() declare body?: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) @IsOptional() @IsUUID() declare community_id?: string | null;
}

export class FeedAdminUpdateDto {
  @ApiPropertyOptional({ type: String, maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) declare title?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() declare body?: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) @IsOptional() @IsUUID() declare community_id?: string | null;
}

export class FeedAdminItemDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String, nullable: true }) declare body: string | null;
  @ApiProperty({ enum: ["draft", "published", "hidden"] }) declare status: string;
  @ApiProperty({ enum: ["manual", "scout"] }) declare source: string;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare source_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare source_fingerprint: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_provider: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_model: string | null;
  @ApiProperty({ type: String, nullable: true }) declare ingest_prompt_version: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare community_id: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: string;
}

export class FeedAdminEnvelopeDto { @ApiProperty({ type: () => FeedAdminItemDto }) declare item: FeedAdminItemDto; }
export class FeedAdminListDto { @ApiProperty({ type: [FeedAdminItemDto] }) declare items: FeedAdminItemDto[]; }
