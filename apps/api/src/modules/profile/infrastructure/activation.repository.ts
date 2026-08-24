import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { ActivationRecord } from "../domain/activation.types.ts";

@Injectable()
export class ActivationRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async loadAndCountSession(userId: UserId): Promise<ActivationRecord> {
    const result = await this.pool.query<ActivationRecord>(
      `insert into user_activation (user_id, sessions_seen) values ($1, 1)
       on conflict (user_id) do update
       set sessions_seen = user_activation.sessions_seen + 1, updated_at = now()
       returning *`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("activation upsert returned no row");
    return row;
  }

  async markReturning(userId: UserId): Promise<ActivationRecord | null> {
    const result = await this.pool.query<ActivationRecord>(`update user_activation set state = 'returning', updated_at = now() where user_id = $1 returning *`, [userId]);
    return result.rows[0] ?? null;
  }

  async update(
    userId: UserId,
    values: Readonly<Partial<Pick<ActivationRecord, "state" | "primary_persona" | "persona_source" | "home_tier" | "activation_checklist" | "home_dismissed_prompts">>> & {
      readonly first_run_completed_at?: Date;
    },
  ): Promise<ActivationRecord | null> {
    const sets: string[] = [];
    const parameters: unknown[] = [userId];
    const add = (column: string, value: unknown): void => {
      parameters.push(value);
      sets.push(`${column} = $${parameters.length}`);
    };
    for (const column of ["state", "primary_persona", "persona_source", "home_tier"] as const) {
      if (values[column] !== undefined) add(column, values[column]);
    }
    if (values.first_run_completed_at !== undefined) add("first_run_completed_at", values.first_run_completed_at);
    if (values.activation_checklist !== undefined) add("activation_checklist", JSON.stringify(values.activation_checklist));
    if (values.home_dismissed_prompts !== undefined) add("home_dismissed_prompts", JSON.stringify(values.home_dismissed_prompts));
    if (sets.length === 0) return null;
    const result = await this.pool.query<ActivationRecord>(`update user_activation set ${sets.join(", ")}, updated_at = now() where user_id = $1 returning *`, parameters);
    return result.rows[0] ?? null;
  }

  async setHasPrinter(userId: UserId, hasPrinter: boolean): Promise<void> {
    await this.pool.query(`update user_activation set has_printer = $2, updated_at = now() where user_id = $1`, [userId, hasPrinter]);
  }
}
