import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import type { DeviceCommandResult, DeviceMetrics } from "../../devices/public/index.ts";
import type { PublicApiKeyScope } from "../public/index.ts";

export class PublicApiKeyBodyDto {
  @ApiPropertyOptional({ type: String }) @Allow() name?: unknown;
  @ApiPropertyOptional({ type: [String] }) @Allow() scopes?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() label?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() scope?: unknown;
}
export class PublicDeviceCommandDto {
  @ApiPropertyOptional({ type: String }) @Allow() command?: unknown;
  @ApiPropertyOptional({ type: Boolean }) @Allow() safe_test_job?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() script?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() file_name?: unknown;
}

export class PublicApiKeySecretDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, writeOnly: true }) declare readonly key: string;
  @ApiProperty({ type: String }) declare readonly key_prefix: string;
  @ApiProperty({ type: String }) declare readonly name: string;
  @ApiProperty({ enum: ["read", "control"], isArray: true }) declare readonly scopes: readonly PublicApiKeyScope[];
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
}
export class PublicApiKeyDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly name: string;
  @ApiProperty({ type: String }) declare readonly key_prefix: string;
  @ApiProperty({ enum: ["read", "control"], isArray: true }) declare readonly scopes: readonly PublicApiKeyScope[];
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly revoked_at: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly last_used_at: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
}
export class PublicApiKeyListDto {
  @ApiProperty({ type: [PublicApiKeyDto] }) declare readonly keys: readonly PublicApiKeyDto[];
}
export class UserApiKeySecretDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, writeOnly: true }) declare readonly key: string;
  @ApiProperty({ type: String }) declare readonly key_prefix: string;
  @ApiProperty({ enum: ["public_api"] }) declare readonly scope: "public_api";
  @ApiProperty({ type: String }) declare readonly label: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
}
export class UserApiKeyDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly label: string | null;
  @ApiProperty({ type: String }) declare readonly key_prefix: string;
  @ApiProperty({ enum: ["public_api"] }) declare readonly scope: "public_api";
  @ApiProperty({ type: String }) declare readonly status: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly last_used_at: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly revoked_at: string | null;
}
export class PublicPaginationDto {
  @ApiProperty({ type: Number }) declare readonly limit: number;
  @ApiProperty({ type: Number }) declare readonly offset: number;
  @ApiProperty({ type: Boolean }) declare readonly has_more: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare readonly next_offset: number | null;
}
export class UserApiKeyListDto {
  @ApiProperty({ type: [UserApiKeyDto] }) declare readonly keys: readonly UserApiKeyDto[];
  @ApiProperty({ type: PublicPaginationDto }) declare readonly pagination: PublicPaginationDto;
}
export class PublicPrinterDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly brand: string;
  @ApiProperty({ type: String }) declare readonly model: string;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly connector_type: string | null;
  @ApiProperty({ type: String }) declare readonly state: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare readonly progress: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly job_id: string | null;
  @ApiProperty({ type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } })
  declare readonly metrics: DeviceMetrics;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly state_updated_at: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly last_seen_at: string | null;
}
export class PublicPrinterListDto {
  @ApiProperty({ type: [PublicPrinterDto] }) declare readonly printers: readonly PublicPrinterDto[];
}
export class PublicTelemetryItemDto {
  @ApiProperty({ type: String, format: "date-time" }) declare readonly recorded_at: string;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly status: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare readonly progress: number | null;
  @ApiProperty({ type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } })
  declare readonly metrics: DeviceMetrics;
}
export class PublicTelemetryDto {
  @ApiProperty({ type: [PublicTelemetryItemDto] }) declare readonly telemetry: readonly PublicTelemetryItemDto[];
}
class PublicCommandIdentityDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly correlation_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly device_id: string;
  @ApiProperty({ type: String }) declare readonly command: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
}
export class PublicQueuedCommandDto extends PublicCommandIdentityDto {
  @ApiProperty({ enum: ["queued"] }) declare readonly status: "queued";
}
export class PublicCommandStatusDto extends PublicCommandIdentityDto {
  @ApiProperty({ enum: ["queued", "leased", "delivered", "acknowledged", "executed", "failed", "expired"] })
  declare readonly status: "queued" | "leased" | "delivered" | "acknowledged" | "executed" | "failed" | "expired";
  @ApiPropertyOptional({
    type: "object",
    nullable: true,
    properties: { ok: { type: "boolean" }, status: { type: "string" }, error_code: { type: "string" }, code: { type: "string" }, message: { type: "string" } },
  })
  declare readonly result: DeviceCommandResult | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly acked_at: string | null;
}
export class PublicTestQueryResultDto {
  @ApiProperty({ type: String }) declare readonly state: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare readonly progress: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly job_id: string | null;
}
export class PublicTestQueryDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly device_id: string;
  @ApiProperty({ enum: ["query"] }) declare readonly command: "query";
  @ApiProperty({ type: PublicTestQueryResultDto }) declare readonly result: PublicTestQueryResultDto;
}
