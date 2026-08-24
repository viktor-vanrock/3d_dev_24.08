import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const makesTables: DomainTableManifest = {
  owns: ["makes", "make_materials", "make_photos"],
  readsForeignViews: ["projects", "project_revisions"],
};
