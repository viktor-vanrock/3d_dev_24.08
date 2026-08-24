import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { ModelId, OrderId, UserId, type ModelId as ModelIdType, type OrderId as OrderIdType, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { OrderStatus } from "../domain/orders.ts";
import type { OrderRecord } from "../public/index.ts";

interface OrderRow {
  readonly id: string;
  readonly master_id: string;
  readonly client_id: string;
  readonly model_id: string | null;
  readonly status: OrderStatus;
  readonly quote_amount_minor: string | null;
  readonly currency: string;
  readonly quote_expires_at: Date | null;
  readonly accept_expires_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function record(row: OrderRow): OrderRecord {
  return {
    ...row,
    id: OrderId(row.id),
    master_id: UserId(row.master_id),
    client_id: UserId(row.client_id),
    model_id: row.model_id === null ? null : ModelId(row.model_id),
  };
}

@Injectable()
export class OrdersRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(input: { readonly masterId: UserIdType; readonly clientId: UserIdType; readonly modelId: ModelIdType | null }): Promise<OrderRecord> {
    const result = await this.pool.query<OrderRow>(
      `insert into orders (master_id, client_id, model_id, status)
       values ($1, $2, $3, 'draft') returning *`,
      [input.masterId, input.clientId, input.modelId],
    );
    return record(result.rows[0]!);
  }

  async find(id: OrderIdType): Promise<OrderRecord | null> {
    const result = await this.pool.query<OrderRow>(`select * from orders where id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? null : record(row);
  }

  async participants(id: OrderIdType): Promise<{
    readonly masterId: UserIdType;
    readonly clientId: UserIdType;
  } | null> {
    const result = await this.pool.query<{
      readonly master_id: string;
      readonly client_id: string;
    }>(`select master_id, client_id from orders where id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? null : { masterId: UserId(row.master_id), clientId: UserId(row.client_id) };
  }

  async updateStatus(id: OrderIdType, from: OrderStatus, to: OrderStatus): Promise<OrderRecord | null> {
    const result = await this.pool.query<OrderRow>(
      `update orders set status = $1, updated_at = now()
       where id = $2 and status = $3 returning *`,
      [to, id, from],
    );
    const row = result.rows[0];
    return row === undefined ? null : record(row);
  }

  async appendEvent(input: {
    readonly orderId: OrderIdType;
    readonly from: OrderStatus;
    readonly to: OrderStatus;
    readonly actorId: UserIdType | null;
    readonly note: unknown;
  }): Promise<void> {
    await this.pool.query(
      `insert into order_events (order_id, from_status, to_status, actor_id, note)
       values ($1, $2, $3, $4, $5)`,
      [input.orderId, input.from, input.to, input.actorId, typeof input.note === "string" ? input.note : null],
    );
  }
}
