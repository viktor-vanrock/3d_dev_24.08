import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const ordersTables: DomainTableManifest = {
  owns: ["order_events", "orders"],
  readsForeignViews: [],
};
