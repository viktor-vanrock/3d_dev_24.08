import { describe, expect, it } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { sanctionIdempotencyPayloadHash } from "./sanctions.ts";

const userId = UserId("11111111-1111-4111-8111-111111111111");

describe("sanction idempotency payload", () => {
  it("is canonical for equal policy fields", () => {
    const first = sanctionIdempotencyPayloadHash({ userId, type: "ban", reasonCode: "fraud", endsAt: null });
    const retry = sanctionIdempotencyPayloadHash({ userId, type: "ban", reasonCode: "fraud", endsAt: null });
    expect(retry.equals(first)).toBe(true);
  });

  it.each([
    { userId, type: "suspension" as const, reasonCode: "fraud" as const, endsAt: null },
    { userId: UserId("22222222-2222-4222-8222-222222222222"), type: "ban" as const, reasonCode: "fraud" as const, endsAt: null },
    { userId, type: "ban" as const, reasonCode: "security" as const, endsAt: null },
    { userId, type: "ban" as const, reasonCode: "fraud" as const, endsAt: new Date("2030-01-01T00:00:00.000Z") },
  ])("changes when a policy field changes", (input) => {
    const original = sanctionIdempotencyPayloadHash({ userId, type: "ban", reasonCode: "fraud", endsAt: null });
    expect(sanctionIdempotencyPayloadHash(input).equals(original)).toBe(false);
  });
});
