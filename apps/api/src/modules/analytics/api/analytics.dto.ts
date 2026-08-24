import { Transform } from "class-transformer";
import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { CONSENT_ACTIONS, type ConsentAction } from "../domain/analytics.ts";

export class RecordConsentDto {
  @ApiProperty({ enum: CONSENT_ACTIONS })
  @IsIn(CONSENT_ACTIONS)
  declare readonly action: ConsentAction;

  @ApiProperty({ type: String, maxLength: 50 })
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare readonly version: string;
}

export class ConsentRecordedDto {
  @ApiProperty({ enum: [true] }) declare readonly ok: true;
}
export class ProductFunnelDto {
  @ApiProperty({ type: Number }) declare readonly window_days: number;
  @ApiProperty({ type: Number }) declare readonly signups: number;
  @ApiProperty({ type: Number }) declare readonly activated: number;
  @ApiProperty({ type: Number }) declare readonly downloaded: number;
  @ApiProperty({ type: Number }) declare readonly activation_pct: number;
  @ApiProperty({ type: Number }) declare readonly download_pct: number;
}
export class ProductActivityDto {
  @ApiProperty({ type: Number }) declare readonly dau: number;
  @ApiProperty({ type: Number }) declare readonly wau: number;
  @ApiProperty({ type: Number }) declare readonly mau: number;
  @ApiProperty({ type: Number }) declare readonly stickiness_pct: number;
}
export class MarketplaceHealthDto {
  @ApiProperty({ type: Number }) declare readonly published_models_30d: number;
  @ApiProperty({ type: Number }) declare readonly published_models_30d_with_download: number;
  @ApiProperty({ type: Number, nullable: true }) declare readonly liquidity_rate: number | null;
  @ApiProperty({ type: Number }) declare readonly searches_30d: number;
  @ApiProperty({ type: Number }) declare readonly searches_with_download_30d: number;
  @ApiProperty({ type: Number, nullable: true }) declare readonly search_to_download_match_rate: number | null;
}
export class AnalyticsHealthDto {
  @ApiProperty({ type: ProductFunnelDto }) declare readonly funnel: ProductFunnelDto;
  @ApiProperty({ type: ProductActivityDto }) declare readonly activity: ProductActivityDto;
  @ApiProperty({ type: MarketplaceHealthDto }) declare readonly marketplace: MarketplaceHealthDto;
}
