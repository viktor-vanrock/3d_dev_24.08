import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
export class BillingPayoutRequisitesDto {
  @ApiPropertyOptional({ type: String }) @Allow() method?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() value?: unknown;
}
export class BillingWebhookObjectDto {
  @ApiProperty({ type: String }) @Allow() declare id: string;
}
export class BillingLooseBodyDto {
  @ApiPropertyOptional({ type: String, format: "uuid" })
  @Allow()
  modelId?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() event?: unknown;
  @ApiPropertyOptional({ type: BillingWebhookObjectDto })
  @Allow()
  object?: BillingWebhookObjectDto | null;
  @ApiPropertyOptional({ type: Number }) @Allow() amountMinor?: unknown;
  @ApiPropertyOptional({ type: BillingPayoutRequisitesDto })
  @Allow()
  requisites?: BillingPayoutRequisitesDto | null;
  @ApiPropertyOptional({ type: String }) @Allow() status?: unknown;
}

export class PurchaseCreatedResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare purchaseId: string;
  @ApiProperty({ type: String, format: "uri", nullable: true }) declare confirmationUrl: string | null;
}

export class BillingWebhookResponseDto {
  @ApiProperty({ type: Boolean, enum: [true] }) declare ok: true;
  @ApiPropertyOptional() declare duplicate?: boolean;
  @ApiPropertyOptional() declare matched?: boolean;
  @ApiPropertyOptional() declare alreadyTerminal?: boolean;
  @ApiPropertyOptional() declare ignoredStatus?: string;
}

export class PurchaseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare model_id: string;
  @ApiProperty({ type: String }) declare model_title: string;
  @ApiProperty({ type: Number }) declare price_minor: number;
  @ApiProperty({ type: String }) declare currency: string;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
}
export class PurchasesResponseDto {
  @ApiProperty({ type: [PurchaseDto] }) declare purchases: readonly PurchaseDto[];
}
export class PurchaseResponseDto {
  @ApiProperty({ type: PurchaseDto }) declare purchase: PurchaseDto;
}

export class SaleDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare model_id: string;
  @ApiProperty({ type: String }) declare model_title: string;
  @ApiProperty({ type: Number }) declare seller_amount_minor: number;
  @ApiProperty({ type: String }) declare currency: string;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare paid_at: Date | null;
}
export class SalesResponseDto {
  @ApiProperty({ type: [SaleDto] }) declare sales: readonly SaleDto[];
}

export class BalanceResponseDto {
  @ApiProperty({ type: Number }) declare availableMinor: number;
  @ApiProperty({ type: Number }) declare holdMinor: number;
  @ApiProperty({ type: String }) declare currency: string;
}

export class PayoutDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: Number }) declare amountMinor: number;
  @ApiProperty({ type: String }) declare currency: string;
  @ApiProperty({ type: String }) declare status: string;
  @ApiProperty({ type: String, format: "date-time" }) declare createdAt: Date;
  @ApiProperty({ type: String, format: "date-time", nullable: true, required: false }) declare processedAt?: Date | null;
}
export class PayoutsResponseDto {
  @ApiProperty({ type: [PayoutDto] }) declare payouts: readonly PayoutDto[];
}
export class PayoutTransitionResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, enum: ["processing", "paid", "failed"] }) declare status: "processing" | "paid" | "failed";
}
