import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import {
  CONCEPT_ANGLES,
  GENERATION_BRANCHES,
  GENERATION_STATUSES,
  type BranchState,
  type ConceptAngle,
  type GenerationBranch,
  type GenerationParameters,
  type GenerationRow,
  type GenerationStatus,
} from "../domain/generations.ts";

function jsonObjectSchema(rootRef: string) {
  const scalarSchemas = [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "string", nullable: true, enum: [null] }];
  return {
    type: "object" as const,
    additionalProperties: {
      oneOf: [...scalarSchemas, { type: "array", items: { oneOf: [...scalarSchemas, { $ref: rootRef }] } }, { $ref: rootRef }],
    },
  };
}

export class GenerationLooseBodyDto {
  @ApiPropertyOptional({ type: String }) @Allow() branch?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() prompt?: unknown;
  @ApiPropertyOptional(jsonObjectSchema("#/components/schemas/GenerationLooseBodyDto/properties/params")) @Allow() params?: GenerationParameters;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() assistant_offer_id?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() source_generation_id?: unknown;
  @ApiPropertyOptional({ type: [String] }) @Allow() source_angles?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() query?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() label?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() motif?: unknown;
  @ApiPropertyOptional({ type: "object", minProperties: 1, additionalProperties: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 } })
  @Allow()
  photos?: unknown;
  @ApiPropertyOptional({ type: [Number] }) @Allow() center?: unknown;
  @ApiPropertyOptional({ type: Number }) @Allow() radius?: unknown;
  @ApiPropertyOptional({ type: Number }) @Allow() floor?: unknown;
  @ApiPropertyOptional({ type: Number }) @Allow() top?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() mode?: unknown;
}

export class GenerationHealthBranchDto {
  @ApiProperty({ type: String, enum: GENERATION_BRANCHES }) declare branch: GenerationBranch;
  @ApiProperty({ type: String, enum: ["available", "degraded", "down", "unknown"] }) declare state: BranchState;
  @ApiProperty({ type: Number }) declare recent_failures: number;
  @ApiProperty({ type: Number }) declare recent_total: number;
  @ApiProperty({ type: String, nullable: true }) declare last_error: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare last_success_at: string | null;
}
export class GenerationHealthResponseDto {
  @ApiProperty({ type: Number, enum: [24] }) declare window_hours: 24;
  @ApiProperty({ type: [GenerationHealthBranchDto] }) declare branches: readonly GenerationHealthBranchDto[];
}
export class ScanCreatedResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
}
export class ScanPhotosResponseDto {
  @ApiProperty({ type: Number, minimum: 0 }) declare photos: number;
}

export class GenerationPreviewShotDto {
  @ApiProperty({ type: String, enum: CONCEPT_ANGLES }) declare angle: ConceptAngle;
  @ApiProperty({ type: String }) declare url: string;
}
export class GenerationProgressDto {
  @ApiProperty({ type: String }) declare phase: string;
  @ApiProperty({ type: Number, nullable: true }) declare progress: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare eta_seconds: number | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare estimate_updated_at: string | null;
}
export class GenerationDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, enum: GENERATION_BRANCHES }) declare branch: GenerationBranch;
  @ApiProperty({ type: String }) declare prompt: string;
  @ApiProperty(jsonObjectSchema("#/components/schemas/GenerationDto/properties/params")) declare params: GenerationRow["params"];
  @ApiProperty({ type: String, enum: GENERATION_STATUSES }) declare status: GenerationStatus;
  @ApiProperty({ type: String, nullable: true }) declare preview_url: string | null;
  @ApiProperty({ type: String, nullable: true }) declare artifact_url: string | null;
  @ApiProperty({ type: [GenerationPreviewShotDto], nullable: true }) declare preview_shots: readonly GenerationPreviewShotDto[] | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare source_generation_id: string | null;
  @ApiProperty({ type: [String], enum: CONCEPT_ANGLES, nullable: true }) declare source_angles: readonly ConceptAngle[] | null;
  @ApiProperty({ type: String, nullable: true }) declare error: string | null;
  @ApiProperty({ type: String, enum: ["timeout", "provider_error"], nullable: true }) declare error_code: "timeout" | "provider_error" | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare retryable: boolean | null;
  @ApiProperty({ type: GenerationProgressDto, nullable: true }) declare progress: GenerationProgressDto | null;
  @ApiProperty({ type: Boolean, nullable: true }) declare delayed: boolean | null;
  @ApiProperty({ type: Number, nullable: true }) declare queue_position: number | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}
export class GenerationResponseDto {
  @ApiProperty({ type: GenerationDto }) declare generation: GenerationDto;
}
export class GenerationsResponseDto {
  @ApiProperty({ type: [GenerationDto] }) declare generations: readonly GenerationDto[];
}

export class ConceptDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare generation_id: string;
  @ApiProperty({ type: String }) declare normalized_query: string;
  @ApiProperty({ type: String }) declare label: string;
  @ApiProperty({ type: String }) declare prompt: string;
  @ApiProperty({ type: String, nullable: true }) declare motif: string | null;
  @ApiProperty({ type: Number }) declare reuse_count: number;
  @ApiProperty({ type: String, enum: ["queued", "running", "ready", "failed"] }) declare status: "queued" | "running" | "ready" | "failed";
  @ApiProperty({ type: String, nullable: true }) declare preview_url: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare score: number | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: string;
}
export class ConceptsResponseDto {
  @ApiProperty({ type: String, nullable: true }) declare query: string | null;
  @ApiProperty({ type: [ConceptDto] }) declare concepts: readonly ConceptDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
  @ApiProperty({ type: Boolean }) declare degraded: boolean;
}
export class ConceptGenerationResponseDto {
  @ApiProperty({ type: ConceptDto }) declare concept: ConceptDto;
  @ApiProperty({ type: GenerationDto, required: false }) declare generation?: GenerationDto;
  @ApiProperty({ type: Boolean }) declare cached: boolean;
}

export class CatalogDraftModelDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String }) declare source_format: string;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: String }) declare craft: string;
}
export class CatalogDraftResponseDto {
  @ApiProperty({ type: CatalogDraftModelDto }) declare model: CatalogDraftModelDto;
}
