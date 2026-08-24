import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import { ORDER_STATUSES, type OrderStatus } from "../domain/orders.ts";

export class CreateOrderDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @Allow()
  masterId?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @Allow()
  modelId?: unknown;
}

export class TransitionOrderDto {
  @ApiPropertyOptional({ type: String }) @Allow() status?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() note?: unknown;
}

export class OrderResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare master_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare client_id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare model_id: string | null;
  @ApiProperty({ type: String, enum: ORDER_STATUSES }) declare status: OrderStatus;
  @ApiProperty({ type: String, nullable: true }) declare quote_amount_minor: string | null;
  @ApiProperty({ type: String }) declare currency: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare quote_expires_at: Date | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare accept_expires_at: Date | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}
