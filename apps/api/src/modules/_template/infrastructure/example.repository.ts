// _template — infrastructure layer. The repository is the SINGLE OWNER of this domain's SQL/S3/
// providers and the ONLY writer of the domain's tables. It is a PRIVATE provider: bound inside
// <domain>.module.ts, never exported from public/ (layers 4/5 enforce this).
//
// Rules this file embodies:
//  - writes only tables in example.tables.ts `owns`;
//  - returns DOMAIN types (branded ids), not raw rows, to callers;
//  - owns the transaction boundary helpers for this domain (until a shared tx helper lands in phase 2).
//
// Nest wiring (@Injectable, constructor(pool)) is added in phase 2 when @nestjs/* is installed; the
// shape below is framework-agnostic so it type-checks today.

import type { Pool } from "pg";
import type { Example, ExampleId } from "../domain/types.ts";
import { brand, unbrand, type UserId } from "../../_kernel/brandedIds.ts";

export class ExampleRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: ExampleId): Promise<Example | null> {
    const { rows } = await this.pool.query<{ id: string; owner_id: string; name: string }>("select id, owner_id, name from example where id = $1", [unbrand(id)]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: brand<ExampleId>(row.id),
      ownerId: brand<UserId>(row.owner_id),
      name: row.name,
    };
  }
}
