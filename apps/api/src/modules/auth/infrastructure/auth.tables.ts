import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const authTables = {
  owns: ["email_otp", "user_identities", "users"],
  readsForeignViews: [],
} as const satisfies DomainTableManifest;
