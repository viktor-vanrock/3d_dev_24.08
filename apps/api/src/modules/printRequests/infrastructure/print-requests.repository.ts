import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { PrintRequestStatus } from "../domain/print-requests.ts";
import type { PrintRequestRecord } from "../public/index.ts";

interface PrintRequestRow {
  readonly id: string;
  readonly master_id: string;
  readonly client_id: string;
  readonly model_id: string | null;
  readonly model_file_id: string | null;
  readonly material_id: string | null;
  readonly material_variant_id: string | null;
  readonly quantity: number;
  readonly due_date: string | null;
  readonly client_note: string | null;
  readonly master_note: string | null;
  readonly status: PrintRequestStatus;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function record(row: PrintRequestRow): PrintRequestRecord {
  return {
    ...row,
    master_id: UserId(row.master_id),
    client_id: UserId(row.client_id),
  };
}

@Injectable()
export class PrintRequestsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(input: {
    readonly masterId: UserIdType;
    readonly clientId: UserIdType;
    readonly modelId: string | null;
    readonly modelFileId: string | null;
    readonly materialId: string | null;
    readonly materialVariantId: string | null;
    readonly quantity: number;
    readonly dueDate: string;
    readonly clientNote: string | null;
  }): Promise<PrintRequestRecord> {
    const result = await this.pool.query<PrintRequestRow>(
      `insert into print_requests
         (master_id, client_id, model_id, model_file_id, material_id,
          material_variant_id, quantity, due_date, client_note, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new') returning *`,
      [input.masterId, input.clientId, input.modelId, input.modelFileId, input.materialId, input.materialVariantId, input.quantity, input.dueDate, input.clientNote],
    );
    return record(result.rows[0]!);
  }

  async list(party: "master_id" | "client_id", userId: UserIdType, historyOnly: boolean): Promise<readonly PrintRequestRecord[]> {
    const statusPredicate = historyOnly ? "in" : "not in";
    const result = await this.pool.query<PrintRequestRow>(
      `select * from print_requests
       where ${party} = $1 and status ${statusPredicate} ('done', 'rejected')
       order by created_at desc limit 200`,
      [userId],
    );
    return result.rows.map(record);
  }

  async find(id: string): Promise<PrintRequestRecord | null> {
    const result = await this.pool.query<PrintRequestRow>(`select * from print_requests where id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? null : record(row);
  }

  async participants(id: string): Promise<{
    readonly masterId: UserIdType;
    readonly clientId: UserIdType;
  } | null> {
    const result = await this.pool.query<{
      readonly master_id: string;
      readonly client_id: string;
    }>(`select master_id, client_id from print_requests where id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? null : { masterId: UserId(row.master_id), clientId: UserId(row.client_id) };
  }

  async updateStatus(id: string, from: PrintRequestStatus, to: PrintRequestStatus): Promise<PrintRequestRecord | null> {
    const result = await this.pool.query<PrintRequestRow>(
      `update print_requests set status = $1, updated_at = now()
       where id = $2 and status = $3 returning *`,
      [to, id, from],
    );
    const row = result.rows[0];
    return row === undefined ? null : record(row);
  }
}
