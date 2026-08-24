import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";

export class AgentBodyDto {
  @ApiPropertyOptional({ type: String }) @Allow() name?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() bio?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() runtime_label?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() label?: unknown;
}
export class AgentAccountDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly avatar_s3_key: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly bio: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly runtime_label: string | null;
  @ApiProperty({ type: String }) declare readonly status: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly revoked_at: string | null;
}
export class AgentAccountResponseDto {
  @ApiProperty({ type: AgentAccountDto }) declare readonly agent: AgentAccountDto;
}
export class AgentPaginationDto {
  @ApiProperty({ type: Number }) declare readonly limit: number;
  @ApiProperty({ type: Number }) declare readonly offset: number;
  @ApiProperty({ type: Boolean }) declare readonly has_more: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare readonly next_offset: number | null;
}
export class AgentListResponseDto {
  @ApiProperty({ type: [AgentAccountDto] }) declare readonly agents: readonly AgentAccountDto[];
  @ApiProperty({ type: AgentPaginationDto }) declare readonly pagination: AgentPaginationDto;
}
export class AgentContentKeyDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly label: string | null;
  @ApiProperty({ type: String }) declare readonly key_prefix: string;
  @ApiProperty({ type: String }) declare readonly status: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly last_used_at: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly revoked_at: string | null;
}
export class MintedAgentContentKeyDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, writeOnly: true }) declare readonly key: string;
  @ApiProperty({ type: String }) declare readonly key_prefix: string;
  @ApiProperty({ enum: ["agent_content"] }) declare readonly scope: "agent_content";
  @ApiProperty({ type: String, format: "uuid" }) declare readonly agent_id: string;
  @ApiProperty({ type: String }) declare readonly label: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
}
export class AgentKeyListResponseDto {
  @ApiProperty({ type: [AgentContentKeyDto] }) declare readonly keys: readonly AgentContentKeyDto[];
}
