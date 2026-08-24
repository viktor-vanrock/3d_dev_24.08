import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const profileTables: DomainTableManifest = {
  owns: ["user_activation", "user_avatar", "user_filaments", "user_materials", "users"],
  // Public-identity author projection flows through the owner's own published contract view
  // (task 6.0); private profile queries keep reading the physical `users` table (owned above).
  readsForeignViews: ["identity_read_v1"],
};
