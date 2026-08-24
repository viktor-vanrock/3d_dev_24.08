import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { MasterServiceRow, MasterServiceWrite } from "../domain/master-services.ts";

@Injectable()
export class MasterServicesRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(
    masterId: UserId,
    input: Required<
      Omit<MasterServiceWrite, "machineId" | "description" | "deliveryZone" | "priceMinMinor" | "priceMaxMinor" | "minOrderAmountMinor" | "leadTimeDaysMin" | "leadTimeDaysMax">
    > &
      Pick<MasterServiceWrite, "machineId" | "description" | "deliveryZone" | "priceMinMinor" | "priceMaxMinor" | "minOrderAmountMinor" | "leadTimeDaysMin" | "leadTimeDaysMax">,
  ): Promise<MasterServiceRow> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<MasterServiceRow>(
          `insert into master_services (master_id,title,description,technology,machine_id,price_mode,price_min_minor,price_max_minor,currency,min_order_qty,min_order_amount_minor,lead_time_days_min,lead_time_days_max,delivery_zone,delivery_method) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
          [
            masterId,
            input.title,
            input.description ?? null,
            input.technology,
            input.machineId ?? null,
            input.priceMode,
            input.priceMinMinor ?? null,
            input.priceMaxMinor ?? null,
            input.currency,
            input.minOrderQty,
            input.minOrderAmountMinor ?? null,
            input.leadTimeDaysMin ?? null,
            input.leadTimeDaysMax ?? null,
            input.deliveryZone ?? null,
            input.deliveryMethod,
          ],
        )
      ).rows[0];
      if (row === undefined) throw new Error("master service insert returned no row");
      await this.replaceMaterials(client, row.id, input.materialIds);
      return row;
    });
  }

  async activeOwner(id: string): Promise<string | null> {
    return (await this.pool.query<{ master_id: string }>("select master_id from master_services where id=$1 and deleted_at is null", [id])).rows[0]?.master_id ?? null;
  }
  async active(id: string): Promise<MasterServiceRow | null> {
    return (await this.pool.query<MasterServiceRow>("select * from master_services where id=$1 and deleted_at is null", [id])).rows[0] ?? null;
  }
  async materialIds(id: string): Promise<readonly string[]> {
    return (await this.pool.query<{ material_id: string }>("select material_id from master_service_materials where master_service_id=$1", [id])).rows.map((row) => row.material_id);
  }
  async rangeState(id: string) {
    return (
      (
        await this.pool.query<{ price_min_minor: string | null; price_max_minor: string | null; lead_time_days_min: number | null; lead_time_days_max: number | null }>(
          "select price_min_minor,price_max_minor,lead_time_days_min,lead_time_days_max from master_services where id=$1",
          [id],
        )
      ).rows[0] ?? null
    );
  }

  async update(id: string, input: MasterServiceWrite): Promise<MasterServiceRow> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<MasterServiceRow>(
          `update master_services set title=coalesce($2,title), description=case when $3::boolean then $4 else description end, technology=coalesce($5,technology), machine_id=case when $6::boolean then $7::uuid else machine_id end, price_mode=coalesce($8,price_mode), price_min_minor=case when $9::boolean then $10::bigint else price_min_minor end, price_max_minor=case when $11::boolean then $12::bigint else price_max_minor end, currency=coalesce($13,currency), min_order_qty=coalesce($14,min_order_qty), min_order_amount_minor=case when $15::boolean then $16::bigint else min_order_amount_minor end, lead_time_days_min=case when $17::boolean then $18::int else lead_time_days_min end, lead_time_days_max=case when $19::boolean then $20::int else lead_time_days_max end, delivery_zone=case when $21::boolean then $22 else delivery_zone end, delivery_method=coalesce($23,delivery_method), updated_at=now() where id=$1 returning *`,
          [
            id,
            input.title,
            input.description !== undefined,
            input.description ?? null,
            input.technology,
            input.machineId !== undefined,
            input.machineId ?? null,
            input.priceMode,
            input.priceMinMinor !== undefined,
            input.priceMinMinor ?? null,
            input.priceMaxMinor !== undefined,
            input.priceMaxMinor ?? null,
            input.currency,
            input.minOrderQty,
            input.minOrderAmountMinor !== undefined,
            input.minOrderAmountMinor ?? null,
            input.leadTimeDaysMin !== undefined,
            input.leadTimeDaysMin ?? null,
            input.leadTimeDaysMax !== undefined,
            input.leadTimeDaysMax ?? null,
            input.deliveryZone !== undefined,
            input.deliveryZone ?? null,
            input.deliveryMethod,
          ],
        )
      ).rows[0];
      if (row === undefined) throw new Error("master service update returned no row");
      if (input.materialIds !== undefined) await this.replaceMaterials(client, row.id, input.materialIds);
      return row;
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.pool.query("update master_services set deleted_at=now(),updated_at=now() where id=$1", [id]);
  }
  async list(masterId: string, limit: number, offset: number): Promise<readonly MasterServiceRow[]> {
    return (
      await this.pool.query<MasterServiceRow>("select * from master_services where master_id=$1 and deleted_at is null order by created_at desc limit $2 offset $3", [
        masterId,
        limit + 1,
        offset,
      ])
    ).rows;
  }

  private async replaceMaterials(client: PoolClient, serviceId: string, materialIds: readonly string[]): Promise<void> {
    await client.query("delete from master_service_materials where master_service_id=$1", [serviceId]);
    for (const materialId of materialIds) await client.query("insert into master_service_materials (master_service_id,material_id) values ($1,$2)", [serviceId, materialId]);
  }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
