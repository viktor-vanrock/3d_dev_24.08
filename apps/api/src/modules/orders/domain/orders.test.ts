import { describe, expect, it } from "vitest";
import { isOrderStatus, isValidOrderTransition, ORDER_TIMEOUT_COLUMN } from "./orders.ts";

describe("orders state machine parity", () => {
  it("keeps legacy transitions and timeout-bearing states", () => {
    expect(isValidOrderTransition("draft", "quote_requested")).toBe(true);
    expect(isValidOrderTransition("accepted", "paid")).toBe(true);
    expect(isValidOrderTransition("completed", "rated")).toBe(true);
    expect(isValidOrderTransition("draft", "paid")).toBe(false);
    expect(isValidOrderTransition("rated", "draft")).toBe(false);
    expect(ORDER_TIMEOUT_COLUMN).toEqual({
      quoted: "quote_expires_at",
      accepted: "accept_expires_at",
    });
    expect(isOrderStatus("ready_for_pickup")).toBe(true);
    expect(isOrderStatus("unknown")).toBe(false);
  });
});
