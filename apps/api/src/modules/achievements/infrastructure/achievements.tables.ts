import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const achievementsTables: DomainTableManifest = {
  owns: ["user_achievements"],
  readsForeignViews: ["achievements", "wardrobe_rewards"],
};
