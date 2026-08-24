import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const printRequestsTables: DomainTableManifest = {
  owns: ["print_requests"],
  readsForeignViews: [],
};
