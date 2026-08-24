import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const projectsTables: DomainTableManifest = {
  owns: [
    "projects",
    "models",
    "model_revisions",
    "model_revision_files",
    "project_revisions",
    "project_revision_models",
    "project_manifest_resolutions",
    "model_tags",
    "tags",
    "storage_blobs",
    "idempotency_records",
    "outbox_events",
  ],
  readsForeignViews: ["identity_read_v1", "tags"],
};
