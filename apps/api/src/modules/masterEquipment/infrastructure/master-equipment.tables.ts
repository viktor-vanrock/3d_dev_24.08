import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const masterEquipmentTables: DomainTableManifest = {
  owns: ["master_equipment", "master_equipment_materials"],
  readsForeignViews: [],
};
