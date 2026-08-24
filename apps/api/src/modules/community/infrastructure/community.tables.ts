import type { DomainTableManifest } from "../../_boundaries/ownership.ts";
export const COMMUNITY_TABLES = {
  owns: ["communities", "community_members", "post_attachments", "posts", "reputation_events", "taggings", "tags", "threads", "votes"],
  readsForeignViews: ["projects", "project_revisions", "project_revision_models", "model_revision_files", "import_bindings"],
} as const satisfies DomainTableManifest;
