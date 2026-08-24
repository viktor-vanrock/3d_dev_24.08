export const ORDER_STATUSES = [
  "draft",
  "quote_requested",
  "quoted",
  "accepted",
  "paid",
  "in_production",
  "printed",
  "shipped",
  "ready_for_pickup",
  "completed",
  "rated",
  "cancelled",
  "disputed",
  "expired",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ["quote_requested", "cancelled"],
  quote_requested: ["quoted", "cancelled", "expired"],
  quoted: ["accepted", "cancelled", "expired"],
  accepted: ["paid", "cancelled", "expired"],
  paid: ["in_production", "disputed"],
  in_production: ["printed", "disputed"],
  printed: ["shipped", "ready_for_pickup", "disputed"],
  shipped: ["completed", "disputed"],
  ready_for_pickup: ["completed", "disputed"],
  completed: ["rated"],
  rated: [],
  cancelled: [],
  disputed: [],
  expired: [],
};

export const ORDER_TIMEOUT_COLUMN: Partial<Record<OrderStatus, "quote_expires_at" | "accept_expires_at">> = {
  quoted: "quote_expires_at",
  accepted: "accept_expires_at",
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
