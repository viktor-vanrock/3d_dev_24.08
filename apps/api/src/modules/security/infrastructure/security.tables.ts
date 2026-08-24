import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const SECURITY_TABLES = {
  owns: [],
  readsForeignViews: [],
} as const satisfies DomainTableManifest;
