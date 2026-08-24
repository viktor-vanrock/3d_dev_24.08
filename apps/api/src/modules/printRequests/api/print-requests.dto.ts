import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import { PRINT_REQUEST_STATUSES, type PrintRequestStatus } from "../domain/print-requests.ts";

export class CreatePrintRequestDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @Allow()
  masterId?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @Allow()
  modelId?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @Allow()
  modelFileId?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @Allow()
  materialId?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @Allow()
  materialVariantId?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 1000 })
  @Allow()
  quantity?: unknown;
  @ApiPropertyOptional({ type: String, format: "date" })
  @Allow()
  dueDate?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() clientNote?: unknown;
}

export class PrintRequestListQueryDto {
  @ApiPropertyOptional({ type: String }) @Allow() view?: unknown;
}

export class TransitionPrintRequestDto {
  @ApiPropertyOptional({ type: String }) @Allow() status?: unknown;
}

export class PrintRequestResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare master_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare client_id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare model_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare model_file_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare material_id: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare material_variant_id: string | null;
  @ApiProperty({ type: Number, minimum: 1 }) declare quantity: number;
  @ApiProperty({ type: String, format: "date", nullable: true }) declare due_date: string | null;
  @ApiProperty({ type: String, nullable: true }) declare client_note: string | null;
  @ApiProperty({ type: String, nullable: true }) declare master_note: string | null;
  @ApiProperty({ type: String, enum: PRINT_REQUEST_STATUSES }) declare status: PrintRequestStatus;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}

export class PrintRequestListResponseDto {
  @ApiProperty({ type: [PrintRequestResponseDto] }) declare items: readonly PrintRequestResponseDto[];
}
