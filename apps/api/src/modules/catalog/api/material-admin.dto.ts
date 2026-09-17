import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import { MATERIAL_ADMIN_KINDS, MATERIAL_ADMIN_STATUSES } from "../domain/material.admin.ts";

const MATERIAL_SPEC_VALUE_SCHEMA = {
  oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
};

export class MaterialAdminQueryDto {
  @ApiPropertyOptional() @Allow() declare readonly q?: string;
  @ApiPropertyOptional({ enum: MATERIAL_ADMIN_KINDS }) @Allow() declare readonly kind?: string;
  @ApiPropertyOptional({ enum: MATERIAL_ADMIN_STATUSES }) @Allow() declare readonly status?: string;
  @ApiPropertyOptional() @Allow() declare readonly limit?: string;
  @ApiPropertyOptional() @Allow() declare readonly offset?: string;
}

export class MaterialAdminCreateDto {
  @ApiProperty({ enum: MATERIAL_ADMIN_KINDS }) @Allow() declare readonly kind?: unknown;
  @ApiProperty({ type: String, minLength: 1, maxLength: 160, pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)*$" }) @Allow() declare readonly slug?: unknown;
  @ApiProperty({ type: String, minLength: 1, maxLength: 200 }) @Allow() declare readonly name?: unknown;
  @ApiProperty({ type: String, format: "uuid" }) @Allow() declare readonly vendor_id?: unknown;
  @ApiProperty({ type: String, format: "uuid" }) @Allow() declare readonly material_type_id?: unknown;
  @ApiProperty({ type: "object", additionalProperties: MATERIAL_SPEC_VALUE_SCHEMA }) @Allow() declare readonly specs?: unknown;
}

export class MaterialAdminUpdateDto {
  @ApiProperty({ type: Number, minimum: 1 }) @Allow() declare readonly version?: unknown;
  @ApiPropertyOptional({ enum: MATERIAL_ADMIN_KINDS }) @Allow() declare readonly kind?: unknown;
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 200 }) @Allow() declare readonly name?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() declare readonly vendor_id?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() declare readonly material_type_id?: unknown;
  @ApiPropertyOptional({ type: "object", additionalProperties: MATERIAL_SPEC_VALUE_SCHEMA }) @Allow() declare readonly specs?: unknown;
}

export class MaterialAdminArchiveDto {
  @ApiProperty({ type: Number, minimum: 1 }) @Allow() declare readonly version?: unknown;
}

export class MaterialAdminPublishDto {
  @ApiProperty({ type: Number, minimum: 1 }) @Allow() declare readonly version?: unknown;
}

export class MaterialAdminRestoreDto {
  @ApiProperty({ type: Number, minimum: 1 }) @Allow() declare readonly version?: unknown;
}

export class MaterialAdminMutationDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty() declare readonly version: number;
}

export class MaterialAdminOptionDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty() declare readonly name: string;
}

export class MaterialAdminOptionsDto {
  @ApiProperty({ type: [MaterialAdminOptionDto] }) declare readonly vendors: readonly MaterialAdminOptionDto[];
  @ApiProperty({ type: [MaterialAdminOptionDto] }) declare readonly material_types: readonly MaterialAdminOptionDto[];
}

export class MaterialAdminItemDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ enum: MATERIAL_ADMIN_KINDS }) declare readonly kind: string;
  @ApiProperty() declare readonly slug: string;
  @ApiProperty() declare readonly name: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly vendor_id: string;
  @ApiProperty() declare readonly vendor_name: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly material_type_id: string;
  @ApiProperty() declare readonly material_type_name: string;
  @ApiProperty({ type: "object", additionalProperties: MATERIAL_SPEC_VALUE_SCHEMA }) declare readonly specs: object;
  @ApiProperty({ enum: MATERIAL_ADMIN_STATUSES }) declare readonly status: string;
  @ApiProperty() declare readonly version: number;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly updated_at: string;
}

export class MaterialAdminListDto {
  @ApiProperty({ type: [MaterialAdminItemDto] }) declare readonly items: readonly MaterialAdminItemDto[];
  @ApiProperty() declare readonly total: number;
  @ApiProperty() declare readonly limit: number;
  @ApiProperty() declare readonly offset: number;
  @ApiProperty() declare readonly has_more: boolean;
}
