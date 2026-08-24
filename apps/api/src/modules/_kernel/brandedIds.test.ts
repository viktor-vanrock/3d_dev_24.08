import { describe, expect, it } from "vitest";
import { ModelId, ProjectId, UserId, brand, unbrand, type Branded } from "./brandedIds.ts";

// Layer 3 verification. Runtime behavior is trivial (identity), so the real guarantee is at the TYPE
// level: the negative cases below are `@ts-expect-error` — if branding ever weakens so a mismatch
// compiles, tsc fails on the unused-expect-error, and this file stops type-checking. The runtime
// asserts just confirm brand/unbrand are value-preserving.

describe("branded domain ids", () => {
  it("brand/unbrand is value-preserving at runtime", () => {
    const raw = "11111111-1111-4111-8111-111111111111";
    const uid = UserId(raw);
    expect(unbrand(uid)).toBe(raw);
    expect(uid).toBe(raw); // still a string at runtime
  });

  it("distinct brands are not assignable to one another (compile-time)", () => {
    const uid: UserId = UserId("u");
    const pid: ProjectId = ProjectId("p");

    // Same value, different brand — must NOT type-check.
    // @ts-expect-error UserId is not assignable to ProjectId
    const wrong1: ProjectId = uid;
    // @ts-expect-error ProjectId is not assignable to UserId
    const wrong2: UserId = pid;

    expect(unbrand(wrong1)).toBe("u");
    expect(unbrand(wrong2)).toBe("p");
  });

  it("a raw string is not assignable to a branded id without brand() (compile-time)", () => {
    // @ts-expect-error plain string is not a UserId
    const bad: UserId = "not-branded";
    expect(bad).toBe("not-branded");
  });

  it("a function expecting one id rejects another id kind (compile-time)", () => {
    function loadModel(_id: ModelId): string {
      return unbrand(_id);
    }
    const uid = UserId("u");
    // @ts-expect-error cannot pass a UserId where a ModelId is expected
    loadModel(uid);
    expect(loadModel(ModelId("m"))).toBe("m");
  });

  it("brand<T>() produces the requested brand", () => {
    const pid = brand<ProjectId>("p");
    const asProject: ProjectId = pid; // ok
    expect(unbrand(asProject)).toBe("p");
    // sanity: Branded is still a string subtype
    const s: string = unbrand(pid satisfies Branded<"ProjectId">);
    expect(s).toBe("p");
  });
});
