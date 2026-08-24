import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const organizationsTables = {
  owns: ["organization_members", "organizations", "vendor_claim_events", "vendor_claims"],
  readsForeignViews: [],
} as const satisfies DomainTableManifest;
