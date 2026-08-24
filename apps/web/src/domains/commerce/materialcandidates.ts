// Клиент апрув-очереди `material_candidates` (MF-848, эпик MF-31/Ф3) — потребляет
// apps/api/src/catalog/material-candidates.ts (MF-846). Тот же приём fetch+credentials:"include"
// без обёртки-интерцептора, что research/api.ts — каждый вызывающий код сам решает по kind.

import { apiFetch } from "@shared/api";
import type { components } from "src/api/generated/openapi";

export type MaterialCandidateStatus = "pending" | "matched" | "merged" | "rejected" | "quarantined";

export type ListCandidatesResult =
  | { kind: "ok"; candidates: readonly components["schemas"]["CandidateDto"][]; has_more: boolean }
  | { kind: "unauthorized" }
  | { kind: "network_error" };

export async function listMaterialCandidates(status: MaterialCandidateStatus = "pending"): Promise<ListCandidatesResult> {
  try {
    const response = await apiFetch(`/material-candidates?status=${status}`, { credentials: "include" });
    if (response.status === 401) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "network_error" };
    const data = (await response.json()) as components["schemas"]["CandidatePageDto"];
    return { kind: "ok", candidates: data.candidates, has_more: data.has_more };
  } catch {
    return { kind: "network_error" };
  }
}

// matched_material_id кандидата почти всегда null на этой фазе (резолвер для филамента ещё не
// написан, MF-846 § «не твоя зона») — но ручка уже отдаёт живую запись, если он когда-нибудь
// появится. Возвращаем CatalogMaterialDetailValueDto — то, что реально показывает diff-панель.
export async function getMaterial(id: string): Promise<components["schemas"]["CatalogMaterialDetailValueDto"] | null> {
  try {
    const response = await apiFetch(`/materials/${encodeURIComponent(id)}`, { credentials: "include" });
    if (!response.ok) return null;
    const data = (await response.json()) as components["schemas"]["CatalogMaterialDetailDto"];
    return data.material;
  } catch {
    return null;
  }
}

export type ApproveResult =
  | { kind: "ok"; material_id: string; material_variant_id: string }
  | { kind: "not_pending"; status: MaterialCandidateStatus }
  | { kind: "unmergeable_raw" }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "network_error" };

export async function approveMaterialCandidate(id: string): Promise<ApproveResult> {
  try {
    const response = await apiFetch(`/material-candidates/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      credentials: "include",
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 404) return { kind: "not_found" };
    if (response.status === 409) {
      const data = (await response.json()) as { status: MaterialCandidateStatus };
      return { kind: "not_pending", status: data.status };
    }
    if (response.status === 422) return { kind: "unmergeable_raw" };
    if (!response.ok) return { kind: "network_error" };
    const data = (await response.json()) as { material_id: string; material_variant_id: string };
    return { kind: "ok", material_id: data.material_id, material_variant_id: data.material_variant_id };
  } catch {
    return { kind: "network_error" };
  }
}

export type RejectResult =
  | { kind: "ok" }
  | { kind: "not_pending"; status: MaterialCandidateStatus }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "network_error" };

export async function rejectMaterialCandidate(id: string): Promise<RejectResult> {
  try {
    const response = await apiFetch(`/material-candidates/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      credentials: "include",
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 404) return { kind: "not_found" };
    if (response.status === 409) {
      const data = (await response.json()) as { status: MaterialCandidateStatus };
      return { kind: "not_pending", status: data.status };
    }
    if (!response.ok) return { kind: "network_error" };
    return { kind: "ok" };
  } catch {
    return { kind: "network_error" };
  }
}