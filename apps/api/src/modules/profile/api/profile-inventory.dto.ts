import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { PROFILE_HOME_TIERS, PROFILE_PERSONAS } from "../domain/activation.types.ts";

export class UpdateActivationDto {
  @ApiPropertyOptional({ enum: ["first_run", "returning"] })
  @IsOptional()
  @IsIn(["first_run", "returning"])
  declare readonly state?: "first_run" | "returning";
  @ApiPropertyOptional({ enum: PROFILE_PERSONAS }) @IsOptional() @IsString() declare readonly primary_persona?: string;
  @ApiPropertyOptional({ enum: ["declared", "inferred"] }) @IsOptional() @IsString() declare readonly persona_source?: string;
  @ApiPropertyOptional({ enum: PROFILE_HOME_TIERS }) @IsOptional() @IsString() declare readonly home_tier?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() declare readonly first_run_completed?: boolean;
  @ApiPropertyOptional({ additionalProperties: { oneOf: [{ type: "boolean" }, { type: "string" }] }, type: "object" })
  @IsOptional()
  @IsObject()
  declare readonly activation_checklist?: Readonly<Record<string, boolean | string>>;
  @ApiPropertyOptional({ additionalProperties: { oneOf: [{ type: "boolean" }, { type: "string" }] }, type: "object" })
  @IsOptional()
  @IsObject()
  declare readonly home_dismissed_prompts?: Readonly<Record<string, boolean | string>>;
}

export class ActivationEventDto {
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly event_name?: string;
  @ApiPropertyOptional({
    additionalProperties: { oneOf: [{ type: "boolean" }, { type: "number" }, { type: "string" }, { nullable: true, type: "string" }] },
    type: "object",
  })
  @IsOptional()
  @IsObject()
  declare readonly props?: Readonly<Record<string, boolean | number | string | null>>;
}

export class InventoryWriteDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() declare readonly material_id?: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) @IsOptional() @IsUUID() declare readonly variant_id?: string | null;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(5000) declare readonly note?: string;
}

export class BuildVolumeDto {
  @ApiPropertyOptional({ minimum: 0 }) declare readonly x?: number;
  @ApiPropertyOptional({ minimum: 0 }) declare readonly y?: number;
  @ApiPropertyOptional({ minimum: 0 }) declare readonly z?: number;
}

export class CreateProfilePrinterDto {
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly link_source?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly lan_endpoint?: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() declare readonly printer_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() declare readonly nozzle_mm?: number;
  @ApiPropertyOptional({ type: () => BuildVolumeDto }) @IsOptional() @IsObject() declare readonly build_volume?: BuildVolumeDto;
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly kinematics?: string;
}

export class UpdateProfilePrinterDto {
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly model?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() declare readonly nozzle_mm?: number;
  @ApiPropertyOptional({ type: () => BuildVolumeDto }) @IsOptional() @IsObject() declare readonly build_volume?: BuildVolumeDto;
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly kinematics?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() declare readonly is_primary?: boolean;
}

export class PrinterCompatibilityQueryDto {
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() declare readonly material_id?: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() declare readonly model_id?: string;
}

export class QueuePrinterCommandDto {
  @ApiPropertyOptional() @IsOptional() @IsString() declare readonly command?: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() declare readonly slice_id?: string;
  @ApiPropertyOptional({ maxLength: 256 }) @IsOptional() @IsString() @MaxLength(256) declare readonly file_name?: string;
}

export class ProfileOkResponseDto {
  @ApiProperty({ enum: [true] }) declare readonly ok: true;
}

export class ActivationRecordDto {
  @ApiProperty({ format: "uuid" }) declare readonly user_id: string;
  @ApiProperty({ enum: ["first_run", "returning"] }) declare readonly state: "first_run" | "returning";
  @ApiProperty() declare readonly has_printer: boolean;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly first_run_completed_at: Date | null;
  @ApiProperty({ enum: PROFILE_PERSONAS, nullable: true }) declare readonly primary_persona: string | null;
  @ApiProperty({ enum: ["declared", "inferred"], nullable: true }) declare readonly persona_source: string | null;
  @ApiProperty({ enum: PROFILE_HOME_TIERS }) declare readonly home_tier: string;
  @ApiProperty({ minimum: 0 }) declare readonly sessions_seen: number;
  @ApiProperty({
    additionalProperties: { oneOf: [{ type: "boolean" }, { type: "string" }] },
    type: "object",
  })
  declare readonly activation_checklist: Readonly<Record<string, boolean | string>>;
  @ApiProperty({
    additionalProperties: { oneOf: [{ type: "boolean" }, { type: "string" }] },
    type: "object",
  })
  declare readonly home_dismissed_prompts: Readonly<Record<string, boolean | string>>;
}

export class InventoryItemDto {
  @ApiProperty({ format: "uuid" }) declare readonly id: string;
  @ApiProperty({ format: "uuid" }) declare readonly material_id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly variant_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare readonly note: string | null;
  @ApiProperty({ format: "date-time" }) declare readonly created_at: Date;
  @ApiProperty() declare readonly name: string;
  @ApiProperty() declare readonly brand: string;
  @ApiProperty() declare readonly material_type: string;
  @ApiProperty({ type: String, nullable: true }) declare readonly color_name: string | null;
  @ApiProperty({ type: String, nullable: true }) declare readonly color_hex: string | null;
}

export class InventoryRecordDto {
  @ApiProperty({ format: "uuid" }) declare readonly id: string;
  @ApiProperty({ format: "uuid" }) declare readonly material_id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly variant_id: string | null;
  @ApiProperty({ type: String, nullable: true }) declare readonly note: string | null;
  @ApiProperty({ format: "date-time" }) declare readonly created_at: Date;
}

export class MaterialsResponseDto {
  @ApiProperty({ type: [InventoryItemDto] }) declare readonly materials: readonly InventoryItemDto[];
}

export class MaterialResponseDto {
  @ApiProperty({ type: InventoryRecordDto }) declare readonly material: InventoryRecordDto;
}

export class FilamentsResponseDto {
  @ApiProperty({ type: [InventoryItemDto] }) declare readonly filaments: readonly InventoryItemDto[];
}

export class FilamentResponseDto {
  @ApiProperty({ type: InventoryRecordDto }) declare readonly filament: InventoryRecordDto;
}

export class ProfilePrinterDto {
  @ApiProperty({ format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly printer_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly catalog_printer_id: string | null;
  @ApiProperty() declare readonly brand: string;
  @ApiProperty() declare readonly model: string;
  @ApiProperty({ type: BuildVolumeDto, nullable: true }) declare readonly build_volume: BuildVolumeDto | null;
  @ApiProperty({ type: String, nullable: true }) declare readonly nozzle_mm: string | null;
  @ApiProperty({ type: String, nullable: true }) declare readonly kinematics: string | null;
  @ApiProperty() declare readonly link_source: string;
  @ApiProperty({ type: String, nullable: true }) declare readonly lan_endpoint: string | null;
  @ApiProperty() declare readonly verified: boolean;
  @ApiProperty() declare readonly is_primary: boolean;
  @ApiProperty({ format: "date-time" }) declare readonly created_at: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly state?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare readonly progress?: number | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare readonly job_id?: string | null;
  @ApiPropertyOptional({ additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] }, type: "object" })
  declare readonly metrics?: Readonly<Record<string, string | number | boolean | null>>;
  @ApiPropertyOptional({ minimum: 0 }) declare readonly seq?: number;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly last_seen_at?: Date | null;
  @ApiPropertyOptional({ enum: ["list", "managed-local", "managed-bridge"] })
  declare readonly connection_mode?: "list" | "managed-local" | "managed-bridge";
  @ApiPropertyOptional({ enum: ["available", "no_telemetry_channel", "offline", "stale", "permission_denied", "server_error"] })
  declare readonly live_availability_reason?: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly last_confirmed_at?: string | null;
  @ApiPropertyOptional({ additionalProperties: { type: "boolean" }, type: "object" })
  declare readonly command_capabilities?: Readonly<Record<string, boolean>>;
}

export class ProfilePrintersResponseDto {
  @ApiProperty({ type: [ProfilePrinterDto] }) declare readonly printers: readonly ProfilePrinterDto[];
}

export class ProfilePrinterResponseDto {
  @ApiProperty({ type: ProfilePrinterDto }) declare readonly printer: ProfilePrinterDto;
}

export class ActivationResponseDto {
  @ApiProperty({ type: ActivationRecordDto }) declare readonly activation: ActivationRecordDto;
  @ApiProperty({ type: [ProfilePrinterDto] }) declare readonly printers: readonly ProfilePrinterDto[];
  @ApiProperty({ type: [InventoryItemDto] }) declare readonly filaments: readonly InventoryItemDto[];
}

export class ActivationUpdateResponseDto {
  @ApiProperty({ type: ActivationRecordDto }) declare readonly activation: ActivationRecordDto;
}

export class PrinterCompatibilityReasonDto {
  @ApiProperty() declare readonly code: string;
  @ApiProperty({ enum: ["warn", "blocked"] }) declare readonly severity: "warn" | "blocked";
  @ApiProperty() declare readonly message: string;
}

export class PrinterCompatibilityResponseDto {
  @ApiProperty({ format: "uuid" }) declare readonly printer_id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly material_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly model_id: string | null;
  @ApiProperty({ enum: ["ok", "warn", "blocked"] }) declare readonly verdict: "ok" | "warn" | "blocked";
  @ApiProperty({ type: [PrinterCompatibilityReasonDto] }) declare readonly reasons: readonly PrinterCompatibilityReasonDto[];
}

export class PrinterLiveResponseDto {
  @ApiProperty() declare readonly live: boolean;
  @ApiProperty({ type: String, nullable: true }) declare readonly state: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare readonly progress: number | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly job_id: string | null;
  @ApiProperty({ additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] }, type: "object" })
  declare readonly metrics: Readonly<Record<string, string | number | boolean | null>>;
  @ApiProperty({ minimum: 0 }) declare readonly seq: number;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly last_seen_at: string | null;
  @ApiProperty({ enum: ["list", "managed-local", "managed-bridge"] })
  declare readonly connection_mode: "list" | "managed-local" | "managed-bridge";
  @ApiProperty({ enum: ["available", "no_telemetry_channel", "offline", "stale", "permission_denied", "server_error"] })
  declare readonly live_availability_reason: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly last_confirmed_at: string | null;
  @ApiProperty({ additionalProperties: { type: "boolean" }, type: "object" })
  declare readonly command_capabilities: Readonly<Record<string, boolean>>;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly state_updated_at: string | null;
}

export class PrinterCommandResponseDto {
  @ApiProperty({ format: "uuid" }) declare readonly id: string;
  @ApiProperty({ format: "uuid" }) declare readonly correlation_id: string;
  @ApiProperty({ format: "uuid" }) declare readonly device_id: string;
  @ApiProperty() declare readonly command: string;
  @ApiProperty({ enum: ["queued"] }) declare readonly status: "queued";
  @ApiProperty({ format: "date-time" }) declare readonly created_at: string;
}

export class PrinterCommandStatusResponseDto {
  @ApiProperty({ format: "uuid" }) declare readonly command_id: string;
  @ApiProperty({ format: "uuid" }) declare readonly correlation_id: string;
  @ApiProperty({ format: "uuid" }) declare readonly device_id: string;
  @ApiProperty() declare readonly command: string;
  @ApiProperty({ enum: ["queued", "leased", "delivered", "acknowledged", "executed", "failed", "expired"] })
  declare readonly status: "queued" | "leased" | "delivered" | "acknowledged" | "executed" | "failed" | "expired";
  @ApiProperty() declare readonly raw_status: string;
  @ApiProperty({ type: String, nullable: true }) declare readonly code: string | null;
  @ApiProperty({ type: String, nullable: true }) declare readonly message: string | null;
  @ApiProperty({ format: "date-time" }) declare readonly timestamp: string;
  @ApiProperty({ format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly acked_at: string | null;
}
