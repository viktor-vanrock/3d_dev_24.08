import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { MasterEquipmentRecord, MasterEquipmentStatus } from "../domain/master-equipment.ts";

@Injectable()
export class MasterEquipmentRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(input: {
    readonly masterId: UserId;
    readonly machineId: string;
    readonly quantity: number;
    readonly status: MasterEquipmentStatus;
    readonly materialIds: readonly string[];
  }): Promise<MasterEquipmentRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const equipment = (
        await client.query<MasterEquipmentRecord>(
          `insert into master_equipment (master_id, machine_id, quantity, status)
         values ($1, $2, $3, $4) returning *`,
          [input.masterId, input.machineId, input.quantity, input.status],
        )
      ).rows[0]!;
      for (const materialId of input.materialIds) {
        await client.query(`insert into master_equipment_materials (master_equipment_id, material_id) values ($1, $2)`, [equipment.id, materialId]);
      }
      await client.query("commit");
      return equipment;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findActive(id: string): Promise<MasterEquipmentRecord | null> {
    return (await this.pool.query<MasterEquipmentRecord>(`select * from master_equipment where id = $1 and deleted_at is null`, [id])).rows[0] ?? null;
  }

  async materialIds(id: string): Promise<readonly string[]> {
    return (await this.pool.query<{ material_id: string }>(`select material_id from master_equipment_materials where master_equipment_id = $1`, [id])).rows.map(
      (row) => row.material_id,
    );
  }

  async update(id: string, quantity: number | undefined, status: MasterEquipmentStatus | undefined, materialIds: readonly string[] | undefined): Promise<MasterEquipmentRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const equipment = (
        await client.query<MasterEquipmentRecord>(
          `update master_equipment set quantity = coalesce($2, quantity), status = coalesce($3, status),
           updated_at = now() where id = $1 returning *`,
          [id, quantity, status],
        )
      ).rows[0]!;
      if (materialIds !== undefined) {
        await client.query(`delete from master_equipment_materials where master_equipment_id = $1`, [id]);
        for (const materialId of materialIds) {
          await client.query(`insert into master_equipment_materials (master_equipment_id, material_id) values ($1, $2)`, [id, materialId]);
        }
      }
      await client.query("commit");
      return equipment;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async softDelete(id: string): Promise<void> {
    await this.pool.query(`update master_equipment set deleted_at = now(), updated_at = now() where id = $1`, [id]);
  }

  async list(masterId: string, limit: number, offset: number): Promise<readonly MasterEquipmentRecord[]> {
    return (
      await this.pool.query<MasterEquipmentRecord>(
        `select * from master_equipment where master_id = $1 and deleted_at is null
       order by created_at desc limit $2 offset $3`,
        [masterId, limit + 1, offset],
      )
    ).rows;
  }
}
