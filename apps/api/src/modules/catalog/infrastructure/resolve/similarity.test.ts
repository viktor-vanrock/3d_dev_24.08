import { describe, expect, it } from "vitest";
import { trigramSimilarity } from "./similarity.ts";

describe("trigramSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(trigramSimilarity("sv06 plus", "sv06 plus")).toBe(1);
  });

  it("is high for near-duplicates (spacing/hyphenation noise)", () => {
    expect(trigramSimilarity("sv06 plus", "sv 06 plus")).toBeGreaterThan(0.7);
    expect(trigramSimilarity("sv06plus", "sv06 plus")).toBeGreaterThan(0.7);
  });

  it("is low for unrelated strings", () => {
    expect(trigramSimilarity("sv06 plus", "ender 3 v3")).toBeLessThan(0.3);
  });

  it("is 0 when either string is empty", () => {
    expect(trigramSimilarity("", "sv06 plus")).toBe(0);
    expect(trigramSimilarity("sv06 plus", "")).toBe(0);
  });
});
