// Клиент дашборда покрытия каталога (MF-647, соседняя backend-карточка MF-645):
// GET /catalog/metrics — снапшот 4 метрик по каталогу станков (apps/api/src/catalog/metrics.ts).

import type { components } from "src/api/generated/openapi";

import { apiFetch } from "@shared/api";

export type CatalogMetrics = components["schemas"]["CatalogMetricsDto"];

export async function getCatalogMetrics(): Promise<CatalogMetrics | null> {
  const response = await apiFetch(`/catalog/metrics`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as CatalogMetrics;
}