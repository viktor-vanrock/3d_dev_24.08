import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { ModelId, UserId, type ModelId as ModelIdType } from "../../_kernel/brandedIds.ts";
import type { ModelMakesPort, ModelMakeSummary } from "../public/index.ts";

@Injectable()
export class ModelMakesRepository implements ModelMakesPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // A "make" targets the marketplace listing = the Project. modelId is the Project id (id/owner_id/
  // title/makes_count are all project-level, auto-followed the models→projects rename).
  async find(modelId: ModelIdType): Promise<ModelMakeSummary | null> {
    const result = await this.pool.query<{ id: string; owner_id: string; title: string }>(`select id, owner_id, title from projects where id = $1`, [modelId]);
    const row = result.rows[0];
    return row === undefined ? null : { id: ModelId(row.id), ownerId: UserId(row.owner_id), title: row.title };
  }

  async findMany(modelIds: readonly ModelIdType[]): Promise<ReadonlyMap<ModelIdType, ModelMakeSummary>> {
    if (modelIds.length === 0) return new Map();
    const result = await this.pool.query<{ id: string; owner_id: string; title: string }>(`select id, owner_id, title from projects where id = any($1::uuid[])`, [modelIds]);
    return new Map(
      result.rows.map((row) => {
        const id = ModelId(row.id);
        return [id, { id, ownerId: UserId(row.owner_id), title: row.title }];
      }),
    );
  }

  async incrementMakesCount(modelId: ModelIdType): Promise<void> {
    await this.pool.query(`update projects set makes_count = makes_count + 1 where id = $1`, [modelId]);
  }

  async modelIdsForTagId(tagId: string): Promise<readonly ModelIdType[]> {
    const result = await this.pool.query<{ model_id: string }>(`select model_id from model_tags where tag_id = $1`, [tagId]);
    return result.rows.map((row) => ModelId(row.model_id));
  }
}
