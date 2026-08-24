import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserInventoryRecord } from "../domain/inventory.types.ts";

@Injectable()
export class ProfileFilamentsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(userId: UserId): Promise<readonly UserInventoryRecord[]> {
    return (
      await this.pool.query<UserInventoryRecord>(
        `select id, material_id, variant_id, note, created_at
       from user_filaments where user_id = $1 order by created_at`,
        [userId],
      )
    ).rows;
  }

  async create(userId: UserId, materialId: string): Promise<UserInventoryRecord> {
    const result = await this.pool.query<UserInventoryRecord>(
      `insert into user_filaments (user_id, material_id) values ($1, $2)
       on conflict (user_id, material_id) do update set user_id = excluded.user_id
       returning id, material_id, variant_id, note, created_at`,
      [userId, materialId],
    );
    return result.rows[0]!;
  }

  async owner(id: string): Promise<{ readonly user_id: string; readonly material_id: string } | null> {
    return (await this.pool.query<{ user_id: string; material_id: string }>(`select user_id, material_id from user_filaments where id = $1`, [id])).rows[0] ?? null;
  }

  async update(id: string, variantId: string | null | undefined, note: string | null | undefined): Promise<UserInventoryRecord> {
    const sets: string[] = [];
    const parameters: unknown[] = [id];
    if (variantId !== undefined) {
      parameters.push(variantId);
      sets.push(`variant_id = $${parameters.length}`);
    }
    if (note !== undefined) {
      parameters.push(note);
      sets.push(`note = $${parameters.length}`);
    }
    const result = await this.pool.query<UserInventoryRecord>(
      `update user_filaments set ${sets.join(", ")} where id = $1
       returning id, material_id, variant_id, note, created_at`,
      parameters,
    );
    return result.rows[0]!;
  }

  async deleteOwned(id: string, userId: UserId): Promise<void> {
    await this.pool.query(`delete from user_filaments where id = $1 and user_id = $2`, [id, userId]);
  }
}
