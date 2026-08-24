import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, ValidateIf } from "class-validator";
import {
  CALIBRATION_DEFECT_TYPES,
  CALIBRATION_NOTES_MAX_LENGTH,
  CALIBRATION_OUTCOMES,
  PROFILE_CLASSES,
  PROFILE_INTENTS,
  type CalibrationDefectType,
  type CalibrationOutcome,
  type ProfileClass,
  type ProfileIntent,
} from "../domain/slicer-profile.ts";

export class ListSlicerProfilesQueryDto {
  @ApiProperty({ enum: PROFILE_CLASSES })
  @IsIn(PROFILE_CLASSES)
  declare readonly class: ProfileClass;
}

export class RecommendSlicerProfileQueryDto {
  @ApiPropertyOptional({ enum: PROFILE_INTENTS, default: "appearance" })
  @IsOptional()
  @IsIn(PROFILE_INTENTS)
  declare readonly intent?: ProfileIntent;
}

export class CreateCalibrationDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  declare readonly machine_id: string;

  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  declare readonly material_id: string;

  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  declare readonly model_id?: string;

  @ApiPropertyOptional({ type: String, format: "uuid" })
  @IsOptional()
  @IsUUID()
  declare readonly make_id?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, exclusiveMinimum: true })
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  declare readonly flow_ratio?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  declare readonly pressure_advance?: number;

  @ApiProperty({ enum: CALIBRATION_OUTCOMES })
  @IsIn(CALIBRATION_OUTCOMES)
  declare readonly outcome: CalibrationOutcome;

  @ApiPropertyOptional({ enum: CALIBRATION_DEFECT_TYPES })
  @IsOptional()
  @IsIn(CALIBRATION_DEFECT_TYPES)
  declare readonly defect_type?: CalibrationDefectType;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  declare readonly photo_s3_key?: string;

  @ApiPropertyOptional({ type: String, maxLength: CALIBRATION_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CALIBRATION_NOTES_MAX_LENGTH)
  @ValidateIf((_object, value: unknown) => value !== undefined)
  declare readonly notes?: string;
}

export interface SlicerParameterMap {
  readonly [name: string]: string | number | boolean | null;
}
export class ListedSlicerProfileDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly name: string;
  @ApiProperty({ type: String }) declare readonly source_name: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare readonly machine_id: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare readonly material_id: string | null;
}
export class SlicerProfileListResponseDto {
  @ApiProperty({ type: [ListedSlicerProfileDto] }) declare readonly profiles: readonly ListedSlicerProfileDto[];
}
export class RecommendedProfileDto {
  @ApiProperty({ type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] } })
  declare readonly params: SlicerParameterMap;
  @ApiProperty({ type: Number }) declare readonly confidence: number;
  @ApiProperty({ type: Boolean }) declare readonly extrapolated: boolean;
}
export class ChangedFieldDto {
  @ApiProperty({ type: String }) declare readonly field: string;
  @ApiProperty({ oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] }) declare readonly value: string | number | boolean | null;
  @ApiProperty({ type: String }) declare readonly reason: string;
}
export class RecommendationExplanationDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly base_profile_id: string;
  @ApiProperty({ type: String }) declare readonly base_profile_name: string;
  @ApiProperty({ enum: ["orcaslicer", "prusaslicer", "cura"] }) declare readonly slicer: string;
  @ApiProperty({ type: String }) declare readonly source_name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly source_url: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly source_ref: string | null;
  @ApiProperty({ type: String }) declare readonly license: string;
  @ApiProperty({ type: [String] }) declare readonly overlay_profile_ids: readonly string[];
  @ApiProperty({ type: [ChangedFieldDto] }) declare readonly changed_fields: readonly ChangedFieldDto[];
}
export class ProfileRecommendationResponseDto {
  @ApiProperty({ enum: ["slicer.profile-recommendation.v1"] }) declare readonly contract_version: "slicer.profile-recommendation.v1";
  @ApiProperty({ type: String, format: "uuid" }) declare readonly printer_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly filament_id: string;
  @ApiProperty({ enum: PROFILE_INTENTS }) declare readonly intent: ProfileIntent;
  @ApiProperty({ type: RecommendedProfileDto }) declare readonly profile: RecommendedProfileDto;
  @ApiProperty({ type: RecommendationExplanationDto }) declare readonly explanation: RecommendationExplanationDto;
  @ApiProperty({ type: String }) declare readonly disclaimer: string;
}
export class CalibrationResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly slicer_profile_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly machine_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly material_id: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare readonly model_id: string | null;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare readonly make_id: string | null;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly user_id: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare readonly flow_ratio: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare readonly pressure_advance: number | null;
  @ApiProperty({ enum: CALIBRATION_OUTCOMES }) declare readonly outcome: CalibrationOutcome;
  @ApiPropertyOptional({ enum: CALIBRATION_DEFECT_TYPES, nullable: true }) declare readonly defect_type: CalibrationDefectType | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly photo_s3_key: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly notes: string | null;
  @ApiProperty({ enum: ["manual", "telemetry"] }) declare readonly source: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
}
export class CalibrationListResponseDto {
  @ApiProperty({ type: [CalibrationResponseDto] }) declare readonly calibrations: readonly CalibrationResponseDto[];
}
export class SlicerRateLimitedResponseDto {
  @ApiProperty({ enum: ["RATE_LIMITED"] }) declare readonly error: "RATE_LIMITED";
  @ApiProperty({ enum: ["calibration_create", "profile_recommendation"] }) declare readonly scope: string;
  @ApiProperty({ type: Number }) declare readonly retry_after_seconds: number;
}
