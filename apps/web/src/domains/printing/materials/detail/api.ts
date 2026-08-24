import { apiFetch } from "@shared/api";
import type { components } from "../../../../api/generated/openapi";

export type MaterialVariant = components["schemas"]["CatalogVariantDto"];
export type MaterialMake = components["schemas"]["CatalogMakeDto"];
export type MaterialDetail = components["schemas"]["CatalogMaterialDetailValueDto"];
export type MaterialDetailPayload = components["schemas"]["CatalogMaterialDetailDto"];

export type MaterialDetailResult =
  | { kind: "ok"; data: MaterialDetailPayload }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "error" };

export async function getMaterialDetail(id: string, offset = 0): Promise<MaterialDetailResult> {
  try {
    const params = new URLSearchParams({ limit: "6", offset: String(offset) });
    const response = await apiFetch(`/materials/${encodeURIComponent(id)}?${params.toString()}`, { credentials: "include" });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 404) return { kind: "not_found" };
    if (!response.ok) return { kind: "error" };
    return { kind: "ok", data: (await response.json()) as components["schemas"]["CatalogMaterialDetailDto"] };
  } catch {
    return { kind: "error" };
  }
}