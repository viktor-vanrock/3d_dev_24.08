import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const modelsTables: DomainTableManifest = {
  // Transitional internal ports retain ownership of non-Project product satellites only.
  owns: [
    "model_download_log",
    "model_embeddings",
    "model_meshes",
    "model_votes",
    "search_index_jobs",
    "slice_job_attempts",
    "slice_job_plate_instances",
    "slice_jobs",
    "slice_reputation",
    "projects",
    "models",
    "model_revisions",
    "model_revision_files",
    "model_tags",
    "storage_blobs",
  ],
  readsForeignViews: ["projects", "models", "model_revisions", "model_revision_files", "project_revisions", "project_revision_models", "model_tags", "storage_blobs"],
};
