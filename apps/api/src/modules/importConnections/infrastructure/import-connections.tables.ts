import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const importConnectionsTables: DomainTableManifest = {
  owns: ["import_connections", "import_bindings"],
  readsForeignViews: ["models"],
};
