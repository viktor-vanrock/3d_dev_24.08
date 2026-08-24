import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { CatalogMakeMachine, CatalogMakeMaterial, CatalogMakesPort } from "../public/index.ts";

@Injectable()
export class CatalogMakesRepository implements CatalogMakesPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async machine(id: string): Promise<CatalogMakeMachine | null> {
    const result = await this.pool.query<CatalogMakeMachine>(`select id, model from machines where id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  async materials(ids: readonly string[]): Promise<ReadonlyMap<string, CatalogMakeMaterial>> {
    if (ids.length === 0) return new Map();
    const result = await this.pool.query<CatalogMakeMaterial>(`select id, name from materials where id = any($1::uuid[])`, [ids]);
    return new Map(result.rows.map((row) => [row.id, row]));
  }
}
