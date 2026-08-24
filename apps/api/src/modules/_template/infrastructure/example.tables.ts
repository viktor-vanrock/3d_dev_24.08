// _template — table-ownership manifest for this domain (layer 2 input, design.md §7.2 / spec
// domain-boundaries). Seed from openspec .../inventory/table-ownership.json for the real domain.
//
// `owns`: tables this domain's repository is the SINGLE writer of. The SQL-ownership test (2b.4)
// fails if this domain writes any table not listed here.
// `readsForeignViews`: versioned read-views of OTHER domains this domain is allowed to read from
// (god-table isolation). Reading a foreign PHYSICAL table (not a view) is a violation.
//
// This is a plain data module (no imports) so the boundary test can import it from every domain
// uniformly.

import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const exampleTables: DomainTableManifest = {
  owns: [
    // "example",
    // "example_revisions",
  ],
  readsForeignViews: [
    // "identity_read_v1",   // reading users' god-table via profile's published view
    // "project_read_v1",    // reading models' god-table via the project owner's view
  ],
};
