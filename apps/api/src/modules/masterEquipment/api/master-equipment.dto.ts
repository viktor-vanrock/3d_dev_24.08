import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Allow } from "class-validator";
import type { CatalogMachineSummary } from "../../catalog/public/index.ts";
import { MASTER_EQUIPMENT_STATUSES, type MasterEquipmentStatus } from "../domain/master-equipment.ts";

const MACHINE_SPECS_REF = "#/components/schemas/MasterEquipmentMachineDto/properties/specs";

export class MasterEquipmentBodyDto {
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() machineId?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() quantity?: unknown;
  @ApiPropertyOptional({ enum: MASTER_EQUIPMENT_STATUSES }) @Allow() status?: unknown;
  @ApiPropertyOptional({ type: [String], format: "uuid" }) @Allow() materialIds?: unknown;
}

export class MasterEquipmentQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() limit?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) @Allow() offset?: unknown;
}

export class MasterEquipmentMachineDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String }) declare kind: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare vendor_id: string | null;
  @ApiProperty({ type: String }) declare model: string;
  @ApiProperty({
    type: "object",
    additionalProperties: {
      oneOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "string", nullable: true, enum: [null] },
        {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "string", nullable: true, enum: [null] }, { $ref: MACHINE_SPECS_REF }] },
        },
        { $ref: MACHINE_SPECS_REF },
      ],
    },
  })
  declare specs: CatalogMachineSummary["specs"];
}

export class MasterEquipmentResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare master_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare machine_id: string;
  @ApiProperty({ type: MasterEquipmentMachineDto, nullable: true }) declare machine: MasterEquipmentMachineDto | null;
  @ApiProperty({ type: Number, minimum: 1 }) declare quantity: number;
  @ApiProperty({ type: String, enum: MASTER_EQUIPMENT_STATUSES }) declare status: MasterEquipmentStatus;
  @ApiProperty({ type: [String], format: "uuid" }) declare material_ids: readonly string[];
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}

export class MasterEquipmentListResponseDto {
  @ApiProperty({ type: [MasterEquipmentResponseDto] }) declare equipment: readonly MasterEquipmentResponseDto[];
  @ApiProperty({ type: Number }) declare limit: number;
  @ApiProperty({ type: Number }) declare offset: number;
  @ApiProperty({ type: Boolean }) declare has_more: boolean;
}

export class MasterEquipmentDeleteResponseDto {
  @ApiProperty({ type: Boolean, enum: [true] }) declare ok: true;
}
