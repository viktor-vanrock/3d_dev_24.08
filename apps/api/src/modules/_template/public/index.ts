// _template — PUBLIC barrel. The ONLY file other modules may import from this domain.
//
// Export here: public ports (interfaces of use-cases other domains may call), published read-view row
// contracts, and branded ids other domains need. NEVER export the repository, application services,
// or domain internals — those stay private (enforced by layers 1/4/5).

export type { ExampleId } from "../domain/types.ts";

// Public port: the surface a *foreign* domain uses to make this domain change its own data.
// A cross-domain write MUST go through a method like this, never a direct INSERT/UPDATE into our table.
export interface ExamplePort {
  /** Foreign domains call this instead of writing our tables directly. */
  getExampleName(id: ExampleId): Promise<string | null>;
}

// Injection token for the public port (Nest DI). Concrete provider is bound inside the module and is
// the only thing exported to the container — the repository behind it is never exported.
export const EXAMPLE_PORT = Symbol("ExamplePort");

// If this domain owns a god-table, publish its versioned read-view row contract here so readers depend
// on the contract, not the physical schema (design.md §7.1). e.g.:
// export interface ExampleReadV1 { id: ExampleId; name: string; visibility: "public" | "private"; }

import type { ExampleId } from "../domain/types.ts";
