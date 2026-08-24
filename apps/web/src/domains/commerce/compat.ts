// Клиент compat.check поверх HTTP (MF-1060, бэкенд apps/api/src/profile/activation.ts,
// сам вердикт считает apps/api/src/compat/check.ts, MF-408/MF-409) — единственный потребитель
// на Фазе 3 (MF-410): бейдж совместимости на карточке модели (compatbadge.tsx) и фильтр
// каталога «совместимо с моим парком» (market.tsx). Никакой логики вердикта здесь нет —
// только запрос к уже готовому эндпоинту.

import { apiFetch } from "@shared/api";
import type { components } from "src/api/generated/openapi";

export type CompatVerdict = components["schemas"]["PrinterCompatibilityResponseDto"]["verdict"];

// Re-export для обратной совместимости (models.types.ts § compat field).
export type CompatReason = components["schemas"]["PrinterCompatibilityReasonDto"];

// GET /me/printers/:id/compat?model_id=&material_id= — оба параметра опциональны и
// независимы (см. комментарий эндпоинта). model_id/material_id здесь — models.id/materials.id,
// не user_filaments.id.
export async function getPrinterCompat(
  printerId: string,
  params: { modelId?: string; materialId?: string } = {},
): Promise<components["schemas"]["PrinterCompatibilityResponseDto"] | null> {
  const query = new URLSearchParams();
  if (params.modelId) query.set("model_id", params.modelId);
  if (params.materialId) query.set("material_id", params.materialId);
  const qs = query.toString();
  const response = await apiFetch(`/me/printers/${encodeURIComponent(printerId)}/compat${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  return (await response.json()) as components["schemas"]["PrinterCompatibilityResponseDto"];
}