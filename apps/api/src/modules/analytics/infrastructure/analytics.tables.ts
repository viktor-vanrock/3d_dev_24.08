import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const analyticsTables: DomainTableManifest = {
  owns: ["consent_records", "events"],
  readsForeignViews: ["marketplace_liquidity_30d", "marketplace_search_match_rate_30d"],
};
