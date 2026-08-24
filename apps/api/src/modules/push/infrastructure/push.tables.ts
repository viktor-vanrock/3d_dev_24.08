import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const pushTables: DomainTableManifest = {
  owns: ["push_preferences", "push_subscriptions"],
  readsForeignViews: [],
};
