import { Allow, IsBoolean, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { PrinterJsonObject, PrinterJsonValue } from "../public/index.ts";

export class PrinterBuildVolumeDto {
  @ApiPropertyOptional({ type: Number }) @Allow() declare x?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare y?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare z?: number;
  @ApiPropertyOptional({ type: String }) @Allow() declare shape?: string;
  @ApiPropertyOptional({ type: Number }) @Allow() declare diameter?: number;
}
export class PrinterHotendDto {
  @ApiPropertyOptional({ type: Number }) @Allow() declare max_temp_c?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare max_flow_mm3s?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare nozzle_default_mm?: number;
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare nozzle_swappable?: boolean;
  @ApiPropertyOptional({ type: String }) @Allow() declare material?: string;
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare hardened?: boolean;
}
export class PrinterBedDto {
  @ApiPropertyOptional({ type: Number }) @Allow() declare max_temp_c?: number;
  @ApiPropertyOptional({ type: String }) @Allow() declare surface?: string;
  @ApiPropertyOptional({ type: String }) @Allow() declare auto_leveling?: string;
}
export class PrinterSpeedDto {
  @ApiPropertyOptional({ type: Number }) @Allow() declare max_speed_mms?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare max_accel_mms2?: number;
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare input_shaping?: boolean;
}
export class PrinterMultimaterialDto {
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare supported?: boolean;
  @ApiPropertyOptional({ type: String }) @Allow() declare system_name?: string;
  @ApiPropertyOptional({ type: Number }) @Allow() declare max_colors?: number;
  @ApiPropertyOptional({ type: String }) @Allow() declare unique_notes?: string;
}
export class PrinterToolheadExtraDto {
  @ApiProperty({ type: String }) @Allow() declare kind: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @Allow() declare spec?: string | null;
}
export class PrinterConnectivityDto {
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare wifi?: boolean;
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare ethernet?: boolean;
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare usb?: boolean;
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare camera?: boolean;
  @ApiPropertyOptional({ type: String }) @Allow() declare firmware?: string;
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare moonraker?: boolean;
  @ApiPropertyOptional({ type: Boolean }) @Allow() declare lan_mode?: boolean;
}
export class PrinterDimensionsDto {
  @ApiPropertyOptional({ type: Number }) @Allow() declare w?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare d?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare h?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare weight_kg?: number;
}
export class PrinterPriceDto {
  @ApiPropertyOptional({ type: Number }) @Allow() declare msrp_usd?: number;
  @ApiPropertyOptional({ type: Number }) @Allow() declare ru_rub?: number;
  @ApiPropertyOptional({ type: String, format: "date" }) @Allow() declare ru_updated_at?: string;
}
export class PrinterMediaDto {
  @ApiPropertyOptional({ type: String, format: "uri", nullable: true }) @Allow() declare hero?: string | null;
  @ApiPropertyOptional({ type: [String] }) @Allow() declare gallery?: string[];
  @ApiPropertyOptional({ type: String, format: "uri", nullable: true }) @Allow() declare official_url?: string | null;
}
export class PrinterResearchMetaDto {
  @ApiProperty({ type: String }) @Allow() declare filled_by: string;
  @ApiProperty({ type: String }) @Allow() declare confidence: string;
  @ApiPropertyOptional({ type: String }) @Allow() declare reviewed_by?: string;
  @ApiPropertyOptional({ type: [String] }) @Allow() declare gaps?: string[];
  @ApiPropertyOptional({ type: String, format: "date-time" }) @Allow() declare base_updated_at?: string;
}

export class CommunityFirmwareQueryDto {
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() printer_id?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

export class CommunityFirmwareCreateDto {
  @ApiPropertyOptional({ type: String }) @Allow() model?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() author?: unknown;
  @ApiPropertyOptional({ type: String, format: "uri" }) @Allow() git_url?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() printer_id?: unknown;
}

export class CommunityFirmwareUpdateDto extends CommunityFirmwareCreateDto {
  @ApiPropertyOptional({ type: Boolean }) @Allow() @IsOptional() @IsBoolean() verified?: boolean;
}

export class IdentifyPrinterDto {
  @ApiPropertyOptional({ type: String }) @Allow() machine_type?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() device_name?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() hostname?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() software_version?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() klipper_path?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() config_file?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() log_file?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() distribution?: unknown;
  @ApiPropertyOptional({ type: [String] }) @Allow() objects?: unknown;
  @ApiPropertyOptional({ type: () => PrinterBuildVolumeDto }) @Allow() build_volume_mm?: PrinterBuildVolumeDto;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) @Allow() nozzle_diameter_mm?: unknown;
}

export class PrusaConnectDto {
  @ApiPropertyOptional({ type: String, format: "password", writeOnly: true }) @Allow() api_key?: unknown;
}

export class ResearchPrinterDto {
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() id?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() slug?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() brand?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() model?: unknown;
  @ApiPropertyOptional({ type: [String] }) @Allow() aliases?: unknown;
  @ApiPropertyOptional({ type: String, format: "date" }) @Allow() released_at?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() status?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() kinematics?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() type?: unknown;
  @ApiPropertyOptional({ type: Boolean }) @Allow() enclosed?: unknown;
  @ApiPropertyOptional({ type: () => PrinterBuildVolumeDto }) @Allow() build_volume?: PrinterBuildVolumeDto;
  @ApiPropertyOptional({ type: () => PrinterHotendDto }) @Allow() hotend?: PrinterHotendDto;
  @ApiPropertyOptional({ type: () => PrinterBedDto }) @Allow() bed?: PrinterBedDto;
  @ApiPropertyOptional({ type: () => PrinterSpeedDto }) @Allow() speed?: PrinterSpeedDto;
  @ApiPropertyOptional({ type: () => PrinterMultimaterialDto }) @Allow() multimaterial?: PrinterMultimaterialDto;
  @ApiPropertyOptional({ type: [PrinterToolheadExtraDto] }) @Allow() toolhead_extras?: PrinterToolheadExtraDto[];
  @ApiPropertyOptional({ type: () => PrinterConnectivityDto }) @Allow() connectivity?: PrinterConnectivityDto;
  @ApiPropertyOptional({ type: [String] }) @Allow() materials_supported?: unknown;
  @ApiPropertyOptional({ type: () => PrinterDimensionsDto }) @Allow() dimensions_mm?: PrinterDimensionsDto;
  @ApiPropertyOptional({ type: () => PrinterPriceDto }) @Allow() price?: PrinterPriceDto;
  @ApiPropertyOptional({ type: [String] }) @Allow() unique_features?: unknown;
  @ApiPropertyOptional({ type: () => PrinterMediaDto }) @Allow() media?: PrinterMediaDto;
  @ApiPropertyOptional({ type: [String] }) @Allow() sources?: string[];
  @ApiPropertyOptional({ type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } })
  @Allow()
  field_sources?: PrinterJsonObject;
  @ApiPropertyOptional({ type: [String] }) @Allow() resolve_conflicts?: string[];
  @ApiPropertyOptional({ type: () => PrinterResearchMetaDto }) @Allow() _meta?: PrinterResearchMetaDto;
}

export class ResearchMediaDto {
  @ApiPropertyOptional({ type: String }) @Allow() slug?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() content_type?: unknown;
}

export class PrinterReportDto {
  @ApiPropertyOptional({ type: String }) @Allow() field?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() note?: unknown;
  @ApiPropertyOptional({ type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } })
  @Allow()
  proposed_value?: PrinterJsonValue;
}

export class PrinterReportsQueryDto {
  @IsOptional() @IsString() status?: string;
}

export class CommunityFirmwareResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare printer_id: string | null;
  @ApiProperty({ type: String }) declare model: string;
  @ApiProperty({ type: String }) declare author: string;
  @ApiProperty({ type: String, format: "uri" }) declare git_url: string;
  @ApiProperty({ type: Boolean }) declare verified: boolean;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Date, format: "date-time" }) declare updated_at: Date;
}
export class CommunityFirmwarePageDto {
  @ApiProperty({ type: [CommunityFirmwareResponseDto] }) declare entries: CommunityFirmwareResponseDto[];
  @ApiProperty({ type: Number }) declare limit: number;
  @ApiProperty({ type: Number }) declare offset: number;
  @ApiProperty({ type: Boolean }) declare has_more: boolean;
}
export class PrinterEnrollmentCodeDto {
  @ApiProperty({ type: String }) declare label: string;
  @ApiProperty({ type: String }) declare hint: string;
  @ApiProperty({ enum: ["default", "number"] }) declare keyboard: string;
}
export class PrinterEnrollmentStepDto {
  @ApiProperty({ type: String }) declare brand: string;
  @ApiProperty({ enum: ["confirm-on-printer", "token-required", "not-required"] }) declare reason: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String }) declare instructions: string;
  @ApiProperty({ type: () => PrinterEnrollmentCodeDto, nullable: true }) declare code: PrinterEnrollmentCodeDto | null;
  @ApiProperty({ enum: ["x-api-key"] }) declare present_as: string;
}
export class PrinterConnectProtocolDto {
  @ApiProperty({ enum: ["moonraker"] }) declare id: string;
  @ApiProperty({ type: [Number] }) declare ports: number[];
  @ApiProperty({ type: String }) declare identity_path: string;
  @ApiProperty({ type: String }) declare system_info_path: string;
  @ApiProperty({ type: String }) declare objects_path: string;
  @ApiProperty({ type: String }) declare toolhead_path: string;
  @ApiProperty({ type: String }) declare upload_path: string;
  @ApiProperty({ type: String }) declare start_path: string;
  @ApiProperty({ type: Number }) declare probe_timeout_ms: number;
  @ApiProperty({ type: Number }) declare probe_concurrency: number;
}
export class PrinterConnectRecipeDto {
  @ApiProperty({ enum: [1] }) declare version: 1;
  @ApiProperty({ type: [PrinterConnectProtocolDto] }) declare protocols: PrinterConnectProtocolDto[];
  @ApiProperty({ type: Number }) declare min_prefix_length: number;
  @ApiProperty({ type: String }) declare access_path: string;
  @ApiProperty({ type: [PrinterEnrollmentStepDto] }) declare enrollment: PrinterEnrollmentStepDto[];
}
export class PrinterIdentityVolumeDto {
  @ApiProperty({ type: Number }) declare x: number;
  @ApiProperty({ type: Number }) declare y: number;
  @ApiProperty({ type: Number }) declare z: number;
}
export class PrinterIdentityMatchDto {
  @ApiProperty({ type: String, format: "uuid" }) declare printer_id: string;
  @ApiProperty({ type: String }) declare slug: string;
  @ApiProperty({ type: String }) declare brand: string;
  @ApiProperty({ type: String }) declare model: string;
  @ApiProperty({ type: String, nullable: true }) declare kinematics: string | null;
  @ApiProperty({ type: () => PrinterIdentityVolumeDto, nullable: true }) declare catalog_build_volume_mm: PrinterIdentityVolumeDto | null;
  @ApiProperty({ enum: ["high", "medium"] }) declare confidence: string;
  @ApiProperty({ type: [String] }) declare matched_by: string[];
}
export class PrinterIdentitySignalsDto {
  @ApiProperty({ type: String, nullable: true }) declare vendor: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare extruders: number | null;
  @ApiProperty({ type: [String] }) declare macro_prefixes: string[];
}
export class PrinterIdentityResponseDto {
  @ApiProperty({ type: () => PrinterIdentityMatchDto, nullable: true }) declare match: PrinterIdentityMatchDto | null;
  @ApiProperty({ type: () => PrinterIdentitySignalsDto }) declare signals: PrinterIdentitySignalsDto;
}
export class PrinterPrusaSyncDto {
  @ApiProperty({ enum: [true] }) declare connected: true;
  @ApiProperty({ type: Number }) declare printers_found: number;
  @ApiProperty({ type: Number }) declare printers_matched: number;
}
export class PrinterPrusaStatusDto {
  @ApiProperty({ type: Boolean }) declare connected: boolean;
  @ApiPropertyOptional({ type: String }) declare status?: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare last_synced_at?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare last_error?: string | null;
}
export class PrinterOkDto {
  @ApiProperty({ type: Boolean }) declare ok: boolean;
}
export class PrinterPilotStatusResponseDto {
  @ApiProperty({ enum: ["no_data", "reported"] }) declare status: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) declare updated_at?: string;
  @ApiPropertyOptional({ enum: ["fresh", "stale"] }) declare freshness?: string;
  @ApiPropertyOptional({ type: String }) declare source?: string;
  @ApiPropertyOptional({ type: String }) declare stage?: string;
  @ApiPropertyOptional({ type: String }) declare confidence?: string;
}
export class PrinterMetaResponseDto {
  @ApiProperty({ type: String }) declare schema_version: string;
  @ApiProperty({ type: String, nullable: true }) declare filled_by: string | null;
  @ApiProperty({ type: String, nullable: true }) declare reviewed_by: string | null;
  @ApiProperty({ type: String, nullable: true }) declare confidence: string | null;
  @ApiProperty({ type: [String] }) declare gaps: string[];
  @ApiProperty({ type: Boolean }) declare verified: boolean;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare updated_at: string | null;
}
export class PrinterResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare slug: string;
  @ApiProperty({ type: String }) declare brand: string;
  @ApiProperty({ type: String }) declare model: string;
  @ApiProperty({ type: [String] }) declare aliases: string[];
  @ApiProperty({ type: String, format: "date", nullable: true }) declare released_at: string | null;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: String, nullable: true }) declare kinematics: string | null;
  @ApiProperty({ type: String, nullable: true }) declare type: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare enclosed: boolean | null;
  @ApiProperty({ type: () => PrinterBuildVolumeDto }) declare build_volume: PrinterBuildVolumeDto;
  @ApiProperty({ type: () => PrinterHotendDto }) declare hotend: PrinterHotendDto;
  @ApiProperty({ type: () => PrinterBedDto }) declare bed: PrinterBedDto;
  @ApiProperty({ type: () => PrinterSpeedDto }) declare speed: PrinterSpeedDto;
  @ApiProperty({ type: () => PrinterMultimaterialDto }) declare multimaterial: PrinterMultimaterialDto;
  @ApiProperty({ type: [PrinterToolheadExtraDto] }) declare toolhead_extras: PrinterToolheadExtraDto[];
  @ApiProperty({ type: () => PrinterConnectivityDto }) declare connectivity: PrinterConnectivityDto;
  @ApiProperty({ type: [String] }) declare materials_supported: string[];
  @ApiProperty({ type: () => PrinterDimensionsDto }) declare dimensions_mm: PrinterDimensionsDto;
  @ApiProperty({ type: () => PrinterPriceDto }) declare price: PrinterPriceDto;
  @ApiProperty({ type: [String] }) declare unique_features: string[];
  @ApiProperty({ type: String, nullable: true }) declare support_level: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare firmware_ready: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare firmware_public: boolean | null;
  @ApiProperty({ type: String, nullable: true }) declare connector_type: string | null;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare firmware_repo: string | null;
  @ApiProperty({ type: () => PrinterPilotStatusResponseDto }) declare pilot_status: PrinterPilotStatusResponseDto;
  @ApiProperty({ type: () => PrinterMediaDto }) declare media: PrinterMediaDto;
  @ApiProperty({ type: [String] }) declare sources: string[];
  @ApiProperty({
    type: "object",
    additionalProperties: {
      oneOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
        { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
      ],
    },
  })
  declare field_sources: PrinterJsonObject;
  @ApiProperty({ type: () => PrinterMetaResponseDto }) declare _meta: PrinterMetaResponseDto;
}
export class PrinterResearchConflictDto {
  @ApiProperty({ type: String }) declare field: string;
  @ApiProperty({ type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } }) declare ours: PrinterJsonValue;
  @ApiProperty({ type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } }) declare theirs: PrinterJsonValue;
}
export class PrinterResearchResponseDto {
  @ApiProperty({ type: () => PrinterResponseDto }) declare printer: PrinterResponseDto;
}
export class PrinterResearchUpsertResponseDto extends PrinterResearchResponseDto {
  @ApiProperty({ type: [PrinterResearchConflictDto] }) declare conflicts: PrinterResearchConflictDto[];
  @ApiProperty({ type: Boolean }) declare draft: boolean;
}
export class PrinterResearchUploadResponseDto {
  @ApiProperty({ type: String, format: "uri" }) declare upload_url: string;
  @ApiProperty({ type: String }) declare key: string;
}
export class PrinterReportResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare printer_id: string;
  @ApiProperty({ type: String }) declare field: string;
  @ApiProperty({ type: String, nullable: true }) declare note: string | null;
  @ApiProperty({ type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } }) declare proposed_value: PrinterJsonValue;
  @ApiProperty({ type: Number }) declare votes: number;
  @ApiProperty({ enum: ["pending", "approved", "rejected"] }) declare status: string;
  @ApiProperty({ type: String }) declare source: string;
  @ApiProperty({ type: String }) declare confidence: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare resolved_by: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare resolved_at: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: string;
}
export class PrinterReportEnvelopeDto {
  @ApiProperty({ type: () => PrinterReportResponseDto }) declare report: PrinterReportResponseDto;
}
export class PrinterReportListItemDto extends PrinterReportResponseDto {
  @ApiProperty({ type: "object", properties: { slug: { type: "string" }, brand: { type: "string" }, model: { type: "string" } } }) declare printer: {
    slug: string;
    brand: string;
    model: string;
  };
}
export class PrinterReportsResponseDto {
  @ApiProperty({ type: [PrinterReportListItemDto] }) declare reports: PrinterReportListItemDto[];
}
export class PrinterReportApprovalDto extends PrinterReportEnvelopeDto {
  @ApiProperty({ type: Boolean }) declare applied: boolean;
  @ApiPropertyOptional({ type: () => PrinterResponseDto }) declare printer?: PrinterResponseDto;
}
