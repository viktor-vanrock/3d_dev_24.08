import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { UserId } from "../../_kernel/brandedIds.ts";
import { BillingRepository } from "./billing.repository.ts";
describe("BillingRepository transaction parity", () => {
  it("rolls back an insufficient payout after taking the advisory lock", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ available: "10", hold: "0" }] })
      .mockResolvedValueOnce({});
    const release = vi.fn();
    const repo = new BillingRepository({
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool);
    await expect(repo.requestPayout(UserId("11111111-1111-4111-8111-111111111111"), 11, {})).resolves.toEqual({ kind: "insufficient" });
    expect(query.mock.calls.map((call) => String(call[0]).trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1))",
      "select coalesce(sum(amount_minor) filter",
      "rollback",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});
