export const MASTER_EQUIPMENT_STATUSES = ["unknown", "online", "busy", "offline"] as const;
export type MasterEquipmentStatus = (typeof MASTER_EQUIPMENT_STATUSES)[number];

export const MAX_EQUIPMENT_MATERIAL_IDS = 20;
export const MAX_EQUIPMENT_QUANTITY = 1000;

export function isMasterEquipmentStatus(value: unknown): value is MasterEquipmentStatus {
  return typeof value === "string" && (MASTER_EQUIPMENT_STATUSES as readonly string[]).includes(value);
}

export interface MasterEquipmentRecord {
  readonly id: string;
  readonly master_id: string;
  readonly machine_id: string;
  readonly quantity: number;
  readonly status: MasterEquipmentStatus;
  readonly deleted_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
