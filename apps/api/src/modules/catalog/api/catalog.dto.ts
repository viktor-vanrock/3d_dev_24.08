import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { CatalogJsonObject, CatalogJsonValue } from "../public/index.ts";

export class CatalogMetadataDto {
  @ApiPropertyOptional({ type: Number }) declare x?: number;
  @ApiPropertyOptional({ type: Number }) declare y?: number;
  @ApiPropertyOptional({ type: Number }) declare z?: number;
  @ApiPropertyOptional({ type: String }) declare kinematics?: string;
  @ApiPropertyOptional({ type: Number }) declare max_nozzle_temp_c?: number;
  @ApiPropertyOptional({ type: Number }) declare max_bed_temp_c?: number;
  @ApiPropertyOptional({ type: String }) declare notes?: string;
  @ApiPropertyOptional({ type: String }) declare vendor?: string;
  @ApiPropertyOptional({ type: String }) declare model?: string;
  @ApiPropertyOptional({ type: String }) declare material_type?: string;
  @ApiPropertyOptional({ type: String }) declare color_name?: string;
}
export class CatalogVendorDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare slug: string;
  @ApiProperty({ type: String }) declare name: string;
  @ApiPropertyOptional({ type: Boolean }) declare verified?: boolean;
}
export class CatalogMakeStatsDto {
  @ApiProperty({ type: Number }) declare make_count: number;
  @ApiProperty({ type: Number }) declare model_count: number;
}
export class CatalogMakeAuthorDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare username: string;
  @ApiProperty({ type: String, nullable: true }) declare display_name: string | null;
  @ApiProperty({ type: String, nullable: true }) declare avatar_url: string | null;
}
export class CatalogMakeModelDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare title: string;
}
export class CatalogMakeDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, nullable: true }) declare caption: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare printability_rating: number | null;
  @ApiProperty({ type: () => CatalogMakeModelDto, nullable: true }) declare model: CatalogMakeModelDto | null;
  @ApiProperty({ type: () => CatalogMakeAuthorDto }) declare user: CatalogMakeAuthorDto;
}
export class CatalogReleaseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare machine_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare vendor_id: string | null;
  @ApiProperty({ type: String }) declare model_name: string;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: String, format: "date", nullable: true }) declare announced_at: string | null;
  @ApiProperty({ type: String, format: "date", nullable: true }) declare preorder_at: string | null;
  @ApiProperty({ type: String, format: "date", nullable: true }) declare ship_at: string | null;
  @ApiProperty({ type: String, format: "date", nullable: true }) declare eol_at: string | null;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare source_url: string | null;
}
export class CatalogReleasesDto {
  @ApiProperty({ type: [CatalogReleaseDto] }) declare releases: CatalogReleaseDto[];
  @ApiProperty({ type: Boolean }) declare has_more: boolean;
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
export class CatalogMaterialTypeDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare slug: string;
  @ApiProperty({ type: String }) declare name: string;
}
export class CatalogMaterialDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare craft: string;
  @ApiProperty({ type: String }) declare kind: string;
  @ApiProperty({ type: String }) declare slug: string;
  @ApiProperty({ type: String }) declare name: string;
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
  declare specs: CatalogJsonObject;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Date, format: "date-time" }) declare updated_at: Date;
  @ApiProperty({ type: () => CatalogVendorDto }) declare vendor: CatalogVendorDto;
  @ApiProperty({ type: () => CatalogMaterialTypeDto }) declare material_type: CatalogMaterialTypeDto;
}
export class CatalogMaterialsDto {
  @ApiProperty({ type: [CatalogMaterialDto] }) declare materials: CatalogMaterialDto[];
  @ApiProperty({ type: Number }) declare total: number;
  @ApiProperty({ type: Number }) declare limit: number;
  @ApiProperty({ type: Number }) declare offset: number;
  @ApiProperty({ type: Boolean }) declare has_more: boolean;
}
export class CatalogVariantDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare color_name: string;
  @ApiProperty({ type: String, nullable: true }) declare color_hex: string | null;
  @ApiProperty({ type: Number }) declare diameter_mm: number;
  @ApiProperty({ type: Number, nullable: true }) declare weight_g: number | null;
  @ApiProperty({ type: String, nullable: true }) declare spool_type: string | null;
  @ApiProperty({ type: String, nullable: true }) declare sku: string | null;
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
  declare specs: CatalogJsonObject;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
}
export class CatalogMaterialDetailValueDto extends CatalogMaterialDto {
  @ApiProperty({ type: [CatalogVariantDto] }) declare variants: CatalogVariantDto[];
  @ApiProperty({ type: () => CatalogMakeStatsDto }) declare make_stats: CatalogMakeStatsDto;
}
export class CatalogMaterialDetailDto {
  @ApiProperty({ type: () => CatalogMaterialDetailValueDto }) declare material: CatalogMaterialDetailValueDto;
  @ApiProperty({ type: [CatalogMakeDto] }) declare makes: CatalogMakeDto[];
  @ApiProperty({ type: Boolean }) declare makes_has_more: boolean;
}
export class CatalogVendorsDto {
  @ApiProperty({ type: [CatalogVendorDto] }) declare vendors: CatalogVendorDto[];
}
export class CatalogMachineDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare craft: string;
  @ApiProperty({ type: String }) declare kind: string;
  @ApiProperty({ type: () => CatalogVendorDto, nullable: true }) declare vendor: CatalogVendorDto | null;
  @ApiProperty({ type: String }) declare model: string;
  @ApiProperty({ type: [String] }) declare aliases: string[];
  @ApiProperty({ type: Number, nullable: true }) declare year: number | null;
  @ApiProperty({ type: Boolean }) declare discontinued: boolean;
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
  declare specs: CatalogJsonObject;
  @ApiProperty({ type: String }) declare integration: string;
  @ApiProperty({ type: String }) declare source: string;
  @ApiProperty({ type: Boolean }) declare verified: boolean;
}
export class CatalogMachinesDto {
  @ApiProperty({ type: [CatalogMachineDto] }) declare machines: CatalogMachineDto[];
  @ApiProperty({ type: Boolean }) declare has_more: boolean;
}
export class CatalogMachineDetailValueDto extends CatalogMachineDto {
  @ApiProperty({ type: () => CatalogMakeStatsDto }) declare make_stats: CatalogMakeStatsDto;
}
export class CatalogMachineDetailDto {
  @ApiProperty({ type: () => CatalogMachineDetailValueDto }) declare machine: CatalogMachineDetailValueDto;
  @ApiProperty({ type: [CatalogMakeDto] }) declare makes: CatalogMakeDto[];
  @ApiProperty({ type: Boolean }) declare makes_has_more: boolean;
}
export class PrinterBuildVolumeDto {
  @ApiProperty({ type: Number, nullable: true }) declare x: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare y: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare z: number | null;
  @ApiProperty({ type: String, nullable: true }) declare shape: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare diameter: number | null;
}
export class PrinterHotendDto {
  @ApiProperty({ type: Number, nullable: true }) declare max_temp_c: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare max_flow_mm3s: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare nozzle_default_mm: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare nozzle_swappable: boolean | null;
  @ApiProperty({ type: String, nullable: true }) declare material: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare hardened: boolean | null;
}
export class PrinterBedDto {
  @ApiProperty({ type: Number, nullable: true }) declare max_temp_c: number | null;
  @ApiProperty({ type: String, nullable: true }) declare surface: string | null;
  @ApiProperty({ type: String, nullable: true }) declare auto_leveling: string | null;
}
export class PrinterSpeedDto {
  @ApiProperty({ type: Number, nullable: true }) declare max_speed_mms: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare max_accel_mms2: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare input_shaping: boolean | null;
}
export class PrinterMultimaterialDto {
  @ApiProperty({ type: Boolean }) declare supported: boolean;
  @ApiProperty({ type: String, nullable: true }) declare system_name: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare max_colors: number | null;
  @ApiProperty({ type: String, nullable: true }) declare unique_notes: string | null;
}
export class PrinterToolheadExtraDto {
  @ApiProperty({ type: String }) declare kind: string;
  @ApiProperty({ type: String, nullable: true }) declare spec: string | null;
}
export class PrinterConnectivityDto {
  @ApiProperty({ type: Boolean, nullable: true }) declare wifi: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare ethernet: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare usb: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare camera: boolean | null;
  @ApiProperty({ type: String, nullable: true }) declare firmware: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare moonraker: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare lan_mode: boolean | null;
}
export class PrinterDimensionsDto {
  @ApiProperty({ type: Number, nullable: true }) declare w: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare d: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare h: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare weight_kg: number | null;
}
export class PrinterPriceDto {
  @ApiProperty({ type: Number, nullable: true }) declare msrp_usd: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare ru_rub: number | null;
  @ApiProperty({ type: String, format: "date", nullable: true }) declare ru_updated_at: string | null;
}
export class PrinterMediaDto {
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare hero: string | null;
  @ApiProperty({ type: [String] }) declare gallery: string[];
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare official_url: string | null;
}
export class PrinterPilotStatusDto {
  @ApiProperty({ enum: ["no_data", "reported"] }) declare status: "no_data" | "reported";
  @ApiPropertyOptional({ type: String, format: "date-time" }) declare updated_at?: string;
  @ApiPropertyOptional({ enum: ["fresh", "stale"] }) declare freshness?: "fresh" | "stale";
  @ApiPropertyOptional({ type: String }) declare source?: string;
  @ApiPropertyOptional({ type: String }) declare stage?: string;
  @ApiPropertyOptional({ type: String }) declare confidence?: string;
}
export class PrinterMetaDto {
  @ApiProperty({ type: String }) declare schema_version: string;
  @ApiProperty({ type: String, nullable: true }) declare filled_by: string | null;
  @ApiProperty({ type: String, nullable: true }) declare reviewed_by: string | null;
  @ApiProperty({ type: String, nullable: true }) declare confidence: string | null;
  @ApiProperty({ type: [String] }) declare gaps: string[];
  @ApiProperty({ type: Boolean }) declare verified: boolean;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare updated_at: string | null;
}
export class PrinterDto {
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
  @ApiProperty({ type: () => PrinterPilotStatusDto }) declare pilot_status: PrinterPilotStatusDto;
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
  declare field_sources: CatalogJsonObject;
  @ApiProperty({ type: () => PrinterMetaDto }) declare _meta: PrinterMetaDto;
}
export class PrinterListPriceDto {
  @ApiProperty({ type: Number, nullable: true }) declare rub: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare usd: number | null;
  @ApiProperty({ type: String, format: "date", nullable: true }) declare rub_updated_at: string | null;
}
export class PrinterListItemDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare slug: string;
  @ApiProperty({ type: String }) declare brand: string;
  @ApiProperty({ type: String }) declare model: string;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: Boolean }) declare verified: boolean;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare image_url: string | null;
  @ApiProperty({ type: () => PrinterListPriceDto }) declare price: PrinterListPriceDto;
  @ApiProperty({ type: () => PrinterBuildVolumeDto }) declare build_volume_mm: PrinterBuildVolumeDto;
  @ApiProperty({ type: String, nullable: true }) declare kinematics: string | null;
  @ApiProperty({ type: [String] }) declare capabilities: string[];
}
export class PrinterCatalogDto {
  @ApiProperty({ enum: ["printers.catalog.v1"] }) declare contract_version: "printers.catalog.v1";
  @ApiProperty({ type: [PrinterListItemDto] }) declare items: PrinterListItemDto[];
  @ApiProperty({ type: [PrinterDto] }) declare printers: PrinterDto[];
  @ApiProperty({ type: Boolean }) declare has_more: boolean;
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
  @ApiProperty({ type: "object", additionalProperties: { type: "number" } }) declare gap_counts: { readonly [key: string]: number };
}
export class PrinterDetailDto {
  @ApiProperty({ type: () => PrinterDto }) declare printer: PrinterDto;
}
export class CatalogMetricsDto {
  @ApiProperty({ type: Number }) declare total_models: number;
  @ApiProperty({ type: Number }) declare complete_specs_pct: number;
  @ApiProperty({ type: Number }) declare verified_pct: number;
  @ApiProperty({ type: Number, nullable: true }) declare median_freshness_days: number | null;
}
export class CandidateMatchedMachineDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare model: string;
  @ApiProperty({ type: String }) declare status: string;
}
export class CandidateDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare source: string;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare source_url: string | null;
  @ApiProperty({ type: String }) declare external_ref: string;
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
  declare raw: CatalogJsonValue;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare matched_material_id?: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare matched_machine_id?: string | null;
  @ApiPropertyOptional({ type: () => CandidateMatchedMachineDto, nullable: true }) declare matched_machine?: CandidateMatchedMachineDto | null;
  @ApiProperty({ type: Number, nullable: true }) declare confidence: number | null;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: Date, format: "date-time" }) declare updated_at: Date;
}
export class CandidatePageDto {
  @ApiProperty({ type: [CandidateDto] }) declare candidates: CandidateDto[];
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: Number }) declare limit: number;
  @ApiProperty({ type: Number }) declare offset: number;
  @ApiProperty({ type: Boolean }) declare has_more: boolean;
}
export class CandidateCreateDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ enum: ["pending"] }) declare status: "pending";
  @ApiProperty({ type: Date, format: "date-time" }) declare created_at: Date;
}
export class CandidateMutationDto {
  @ApiProperty({ enum: ["merged", "rejected"] }) declare status: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare material_candidate_id?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare material_id?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare material_variant_id?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare machine_candidate_id?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare machine_id?: string;
}
