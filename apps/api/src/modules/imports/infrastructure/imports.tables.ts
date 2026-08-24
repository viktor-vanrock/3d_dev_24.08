import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const importsTables: DomainTableManifest = {
  owns: ["import_bindings", "import_jobs", "import_job_items"],
  readsForeignViews: [],
};
