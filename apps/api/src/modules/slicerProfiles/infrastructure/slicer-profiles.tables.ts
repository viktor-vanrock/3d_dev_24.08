import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const slicerProfilesTables: DomainTableManifest = {
  owns: ["slicer_profile_calibrations"],
  readsForeignViews: ["slicer_profiles"],
};
