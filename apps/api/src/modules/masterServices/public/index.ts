import type { UserId } from "../../_kernel/brandedIds.ts";

export const MASTER_SERVICES_PORT = Symbol("MASTER_SERVICES_PORT");

export interface MasterServiceResponse {
  readonly id: string;
  readonly master_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly technology: string;
  readonly machine_id: string | null;
  readonly price_mode: string;
  readonly price_min_minor: number | null;
  readonly price_max_minor: number | null;
  readonly currency: string;
  readonly min_order_qty: number;
  readonly min_order_amount_minor: number | null;
  readonly lead_time_days_min: number | null;
  readonly lead_time_days_max: number | null;
  readonly delivery_zone: string | null;
  readonly delivery_method: string;
  readonly material_ids: readonly string[];
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface MasterServicesListResponse {
  readonly services: readonly MasterServiceResponse[];
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
}

export interface MasterServicesPort {
  create(masterId: UserId, body: Readonly<Record<string, unknown>>): Promise<MasterServiceResponse>;
  update(masterId: UserId, serviceId: string, body: Readonly<Record<string, unknown>>): Promise<MasterServiceResponse>;
  delete(masterId: UserId, serviceId: string): Promise<{ readonly ok: true }>;
  detail(serviceId: string): Promise<MasterServiceResponse>;
  list(masterId: string, query: Readonly<Record<string, unknown>>): Promise<MasterServicesListResponse>;
}
