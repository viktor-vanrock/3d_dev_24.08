import { describe, expect, it } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { SanctionEndsAtInPastError, SanctionInvalidReasonCodeError, SanctionSelfTargetError } from "./sanction.errors.ts";
import { assertCanCreate, canonicalizeIdempotencyPayload, computeIdempotencyHash } from "./sanction-policy.ts";

const actorId = UserId("11111111-1111-4111-8111-111111111111");
const userId = UserId("22222222-2222-4222-8222-222222222222");
const valid = { actorId, userId, type: "ban" as const, reasonCode: "fraud" as const, endsAt: null };

describe("sanction policy", () => {
  it("canonicalizes and hashes only sanction policy fields", () => {
    expect(canonicalizeIdempotencyPayload(valid)).toBe("22222222-2222-4222-8222-222222222222\0ban\0fraud\0");
    expect(computeIdempotencyHash(valid).equals(computeIdempotencyHash({ ...valid }))).toBe(true);
  });

  it("rejects self-targeting, legacy reason codes, and ended sanctions", () => {
    expect(() => assertCanCreate({ ...valid, userId: actorId })).toThrow(SanctionSelfTargetError);
    expect(() => assertCanCreate({ ...valid, reasonCode: "legacy" })).toThrow(SanctionInvalidReasonCodeError);
    expect(() => assertCanCreate({ ...valid, endsAt: new Date("2029-01-01T00:00:00.000Z"), now: new Date("2030-01-01T00:00:00.000Z") })).toThrow(SanctionEndsAtInPastError);
  });
});
