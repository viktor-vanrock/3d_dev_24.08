import { Allow } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class MasterServiceBodyDto {
  @ApiPropertyOptional({ type: String }) @Allow() title?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() description?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() technology?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() machineId?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() priceMode?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) @Allow() priceMinMinor?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) @Allow() priceMaxMinor?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() currency?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() minOrderQty?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) @Allow() minOrderAmountMinor?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) @Allow() leadTimeDaysMin?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) @Allow() leadTimeDaysMax?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() deliveryZone?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() deliveryMethod?: unknown;
  @ApiPropertyOptional({ type: [String], format: "uuid" }) @Allow() materialIds?: unknown;
}

export class MasterServicesQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() limit?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) @Allow() offset?: unknown;
}

export class MasterServiceResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare master_id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String, nullable: true }) declare description: string | null;
  @ApiProperty({ type: String }) declare technology: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare machine_id: string | null;
  @ApiProperty({ type: String }) declare price_mode: string;
  @ApiProperty({ type: Number, nullable: true }) declare price_min_minor: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare price_max_minor: number | null;
  @ApiProperty({ type: String }) declare currency: string;
  @ApiProperty({ type: Number }) declare min_order_qty: number;
  @ApiProperty({ type: Number, nullable: true }) declare min_order_amount_minor: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare lead_time_days_min: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare lead_time_days_max: number | null;
  @ApiProperty({ type: String, nullable: true }) declare delivery_zone: string | null;
  @ApiProperty({ type: String }) declare delivery_method: string;
  @ApiProperty({ type: [String], format: "uuid" }) declare material_ids: readonly string[];
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}

export class MasterServiceListResponseDto {
  @ApiProperty({ type: [MasterServiceResponseDto] }) declare services: readonly MasterServiceResponseDto[];
  @ApiProperty({ type: Number }) declare limit: number;
  @ApiProperty({ type: Number }) declare offset: number;
  @ApiProperty({ type: Boolean }) declare has_more: boolean;
}

export class MasterServiceDeleteResponseDto {
  @ApiProperty({ type: Boolean, enum: [true] }) declare ok: true;
}
