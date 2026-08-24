import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const makersTables: DomainTableManifest = {
  owns: ["maker_profiles", "user_follows"],
  readsForeignViews: [],
};
