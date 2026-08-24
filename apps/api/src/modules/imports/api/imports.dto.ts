import { ApiProperty } from "@nestjs/swagger";
import { Allow } from "class-validator";

export class CreateImportJobDto {
  @ApiProperty({ type: String, format: "uuid" }) @Allow() declare readonly connection_id: string;
  @ApiProperty({ type: String }) @Allow() declare readonly source_platform: string;
  @ApiProperty({ type: [String], minItems: 1 })
  @Allow()
  declare readonly external_ids: readonly string[];
}

export class ImportJobCreatedResponseDto {
  @ApiProperty({ format: "uuid" }) declare readonly id: string;
  @ApiProperty({ enum: ["queued"] }) declare readonly status: "queued";
  @ApiProperty({ minimum: 1 }) declare readonly total_count: number;
  @ApiProperty({ enum: [0] }) declare readonly done_count: 0;
  @ApiProperty({ enum: [0] }) declare readonly failed_count: 0;
}

export class ImportJobProgressDto {
  @ApiProperty({ format: "uuid" }) declare readonly id: string;
  @ApiProperty() declare readonly source_platform: string;
  @ApiProperty() declare readonly status: string;
  @ApiProperty({ minimum: 0 }) declare readonly total_count: number;
  @ApiProperty({ minimum: 0 }) declare readonly done_count: number;
  @ApiProperty({ minimum: 0 }) declare readonly failed_count: number;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: Date | string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly started_at: Date | string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly finished_at: Date | string | null;
}

export class ImportJobsResponseDto {
  @ApiProperty({ type: [ImportJobProgressDto] }) declare readonly jobs: readonly ImportJobProgressDto[];
}

export class ImportJobItemProgressDto {
  @ApiProperty() declare readonly external_id: string;
  @ApiProperty() declare readonly status: string;
  @ApiProperty() declare readonly retryable: boolean;
  @ApiProperty({ minimum: 0 }) declare readonly attempt_count: number;
  @ApiProperty({ type: String, nullable: true }) declare readonly last_error: string | null;
}

export class ImportJobDetailResponseDto extends ImportJobProgressDto {
  @ApiProperty({ type: [ImportJobItemProgressDto] }) declare readonly items: readonly ImportJobItemProgressDto[];
}
