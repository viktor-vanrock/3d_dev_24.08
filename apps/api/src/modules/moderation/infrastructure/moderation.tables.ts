import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const moderationTables: DomainTableManifest = {
  owns: ["reports"],
  readsForeignViews: [],
};
