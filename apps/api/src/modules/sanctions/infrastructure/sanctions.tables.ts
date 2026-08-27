import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const sanctionsTables: DomainTableManifest = {
  owns: ["sanctions", "sanction_appeals"],
  readsForeignViews: [],
};
