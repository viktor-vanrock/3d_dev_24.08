import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const ideasTables: DomainTableManifest = {
  owns: ["ideas", "idea_votes", "idea_vote_log", "idea_comments", "idea_enrichments", "idea_notifications"],
  readsForeignViews: [],
};
