// Клиент дашборда здоровья продукта (MF-733, соседние backend-карточки MF-731/MF-732):
// GET /analytics/health — три блока (воронка, DAU/MAU, liquidity/match-rate маркетплейса),
// apps/api/src/analytics/health.route.ts.

import { apiFetch } from "@shared/api";
import type { components } from "src/api/generated/openapi";

export interface ProductFunnel {
  window_days: number;
  signups: number;
  activated: number;
  downloaded: number;
  activation_pct: number;
  download_pct: number;
}

export interface ProductActivity {
  dau: number;
  wau: number;
  mau: number;
  stickiness_pct: number;
}

export interface MarketplaceHealth {
  published_models_30d: number;
  published_models_30d_with_download: number;
  liquidity_rate: number | null;
  searches_30d: number;
  searches_with_download_30d: number;
  search_to_download_match_rate: number | null;
}

export interface ProductHealth {
  funnel: ProductFunnel;
  activity: ProductActivity;
  marketplace: MarketplaceHealth;
}

export async function getProductHealth(): Promise<
  components["schemas"]["AnalyticsHealthDto"] | null
> {
  const response = await apiFetch(`/analytics/health`, { credentials: "include" });
  if (!response.ok) return null;
  return (await response.json()) as components["schemas"]["AnalyticsHealthDto"];
}
