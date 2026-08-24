import type { ModelId, OrderId, UserId } from "../../_kernel/brandedIds.ts";
import type { OrderStatus } from "../domain/orders.ts";

export const ORDERS_PORT = Symbol("ORDERS_PORT");
export const ORDERS_PROFILE_PORT = Symbol("ORDERS_PROFILE_PORT");
export const ORDERS_NOTIFICATION_PORT = Symbol("ORDERS_NOTIFICATION_PORT");
export const ORDERS_PAYMENT_PORT = Symbol("ORDERS_PAYMENT_PORT");

export interface OrderRecord {
  readonly id: OrderId;
  readonly master_id: UserId;
  readonly client_id: UserId;
  readonly model_id: ModelId | null;
  readonly status: OrderStatus;
  readonly quote_amount_minor: string | null;
  readonly currency: string;
  readonly quote_expires_at: Date | null;
  readonly accept_expires_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface OrdersProfilePort {
  exists(userId: UserId): Promise<boolean>;
}

export interface OrdersNotificationPort {
  statusChanged(userId: UserId, orderId: OrderId, status: OrderStatus): Promise<void>;
}

export interface OrdersPaymentPort {
  paid(order: OrderRecord): Promise<void>;
}

export interface OrdersPort {
  create(userId: UserId, body: { readonly masterId?: unknown; readonly modelId?: unknown }): Promise<OrderRecord>;
  get(userId: UserId, rawId: string): Promise<OrderRecord>;
  transition(userId: UserId, rawId: string, body: { readonly status?: unknown; readonly note?: unknown }): Promise<OrderRecord>;
}

export type { OrderStatus } from "../domain/orders.ts";
export { getPaymentHook } from "../infrastructure/payment-hook.ts";
