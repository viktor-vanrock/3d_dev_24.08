// _template — domain layer. Entities, value objects, invariants. NO framework, NO SQL, NO Nest.
// This is the pure core; it may import _kernel (branded ids) but nothing from other modules.

import type { UserId } from "../../_kernel/brandedIds.ts";

// Replace `Example` with the real aggregate as the domain migrates.
export interface Example {
  readonly id: ExampleId;
  readonly ownerId: UserId;
  readonly name: string;
}

// A domain that owns an entity declares its branded id here (or promotes it into _kernel/brandedIds
// once it crosses module boundaries). Kept local while the id is internal to the domain.
import type { Branded } from "../../_kernel/brandedIds.ts";
export type ExampleId = Branded<"ExampleId">;
