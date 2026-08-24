import { describe, expect, it } from "vitest";

import { parseArguments } from "./backfill-repos.ts";

describe("backfill repositories CLI", () => {
  it("rejects a bounded completion audit", () => {
    expect(() => parseArguments(["--completion-check", "--limit", "1"])).toThrow("must be exhaustive");
  });

  it("allows limits for work and diagnostic modes", () => {
    expect(parseArguments(["--migrate", "--limit", "1"])).toEqual({ mode: "migrate", limit: 1 });
    expect(parseArguments(["--verify-only", "--limit", "2"])).toEqual({ mode: "verify", limit: 2 });
    expect(parseArguments(["--reconcile-descriptions", "--limit", "3"])).toEqual({ mode: "reconcile", limit: 3 });
  });
});
