import type { UserId } from "../../_kernel/brandedIds.ts";
import type { CatalogMachineSummary } from "../../catalog/public/index.ts";
import type { MasterEquipmentStatus } from "../domain/master-equipment.ts";

export const MASTER_EQUIPMENT_PORT = Symbol("MASTER_EQUIPMENT_PORT");

export interface MasterEquipmentResponse {
  readonly id: string;
  readonly master_id: string;
  readonly machine_id: string;
  readonly machine: CatalogMachineSummary | null;
  readonly quantity: number;
  readonly status: MasterEquipmentStatus;
  readonly material_ids: readonly string[];
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface MasterEquipmentListResponse {
  readonly equipment: readonly MasterEquipmentResponse[];
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
}

export interface MasterEquipmentPort {
  create(userId: UserId, body: Record<string, unknown>): Promise<MasterEquipmentResponse>;
  update(userId: UserId, id: string, body: Record<string, unknown>): Promise<MasterEquipmentResponse>;
  delete(userId: UserId, id: string): Promise<{ readonly ok: true }>;
  list(masterId: string, query: Record<string, unknown>): Promise<MasterEquipmentListResponse>;
}
