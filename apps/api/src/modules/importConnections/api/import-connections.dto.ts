import { Allow } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class ConnectImportAccountDto {
  @ApiProperty({ type: String }) @Allow() source_platform?: unknown;
  @ApiProperty({ type: String }) @Allow() username?: unknown;
  @ApiProperty({ type: String, format: "password", writeOnly: true }) @Allow() api_key?: unknown;
}

export class ImportConnectionChallengeDto {
  @ApiProperty({ type: String }) @Allow() target?: unknown;
}

export class ImportConnectionVerifyDto {
  @ApiProperty({ type: String }) @Allow() observed_text?: unknown;
}

export class ImportConnectionConnectedResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, enum: ["cults3d"] }) declare source_platform: "cults3d";
  @ApiProperty({ type: String, enum: ["verified"] }) declare ownership_status: "verified";
  @ApiProperty({ type: Number, minimum: 0 }) declare models_found: number;
}

export class ImportConnectionDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare source_platform: string;
  @ApiProperty({ type: String, nullable: true }) declare external_username: string | null;
  @ApiProperty({ type: String }) declare ownership_status: string;
  @ApiProperty({ type: String, nullable: true }) declare challenge_token: string | null;
  @ApiProperty({ type: String, nullable: true }) declare challenge_target: string | null;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: String, nullable: true }) declare last_error: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare last_synced_at: Date | string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date | string;
}

export class ImportBindingDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare model_id: string;
  @ApiProperty({ type: String }) declare source_platform: string;
  @ApiProperty({ type: String }) declare external_id: string;
  @ApiProperty({ type: String }) declare ownership_status: string;
  @ApiProperty({ type: String, format: "date-time" }) declare imported_at: Date | string;
}

export class ImportConnectionsListResponseDto {
  @ApiProperty({ type: [ImportConnectionDto] }) declare connections: readonly ImportConnectionDto[];
  @ApiProperty({ type: [ImportBindingDto] }) declare bindings: readonly ImportBindingDto[];
}

export class ExternalImportModelDto {
  @ApiProperty({ type: String }) declare externalId: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String, format: "uri" }) declare originalUrl: string;
  @ApiProperty({ type: String, format: "uri", required: false }) declare thumbnailUrl?: string;
}

export class ImportModelsResponseDto {
  @ApiProperty({ type: [ExternalImportModelDto] }) declare models: readonly ExternalImportModelDto[];
}
export class ImportChallengeResponseDto {
  @ApiProperty({ type: String }) declare token: string;
}
export class ImportVerificationResponseDto {
  @ApiProperty({ type: String, enum: ["verified", "rejected"] }) declare ownership_status: "verified" | "rejected";
}
