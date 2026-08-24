// Способ изготовления модели (MF-1961, docs/epics/formats.policy.md/domain.model.md §
// «Ремёсла») — типизированный факт `models.manufacturing_method` (миграция
// 20260719180000_model_manufacturing_facets.sql), НЕ тег: заказчик карточки явно попросил не
// прятать AMS/технологию в свободные теги. Отдельно от `craft` — craft группирует ремесло
// ('3d_printing'/'cnc'/…), этот список различает технологию ВНУТРИ печатного ремесла (FDM vs
// SLA — оба печатают STL/OBJ/3MF, разница не выводима из формата файла, см. миграцию).
export const MANUFACTURING_METHODS = ["fdm", "sla", "cnc", "laser"] as const;
export type ManufacturingMethod = (typeof MANUFACTURING_METHODS)[number];

export function isManufacturingMethod(value: unknown): value is ManufacturingMethod {
  return typeof value === "string" && (MANUFACTURING_METHODS as readonly string[]).includes(value);
}
