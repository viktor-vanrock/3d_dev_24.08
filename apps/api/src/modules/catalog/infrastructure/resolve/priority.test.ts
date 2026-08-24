import { describe, expect, it } from "vitest";
import { sourcePriorityScore, UNTRACKED_FIELD_SCORE } from "./priority.ts";

describe("sourcePriorityScore", () => {
  it("ranks vendor site above structural profile above catalog above news", () => {
    const vendor = sourcePriorityScore("sovol3d-store", 0.5);
    const structural = sourcePriorityScore("cura-definitions", 0.5);
    const catalog = sourcePriorityScore("some-catalog-aggregator", 0.5);
    const news = sourcePriorityScore("printer-news-feed", 0.5);
    expect(vendor).toBeGreaterThan(structural);
    expect(structural).toBeGreaterThan(catalog);
    expect(catalog).toBeGreaterThan(news);
  });

  it("never lets confidence cross a tier boundary", () => {
    const catalogHighConfidence = sourcePriorityScore("some-catalog-aggregator", 1);
    const structuralLowConfidence = sourcePriorityScore("cura-definitions", 0);
    expect(catalogHighConfidence).toBeLessThan(structuralLowConfidence);
  });

  it("uses confidence as a tie-break within the same tier", () => {
    const high = sourcePriorityScore("sovol3d-store", 0.9);
    const low = sourcePriorityScore("sovol3d-store", 0.2);
    expect(high).toBeGreaterThan(low);
  });

  it("defaults missing confidence to the middle of the tier", () => {
    const withNull = sourcePriorityScore("sovol3d-store", null);
    const withHalf = sourcePriorityScore("sovol3d-store", 0.5);
    expect(withNull).toBe(withHalf);
  });

  it("untracked-field score sits strictly between catalog and structural tiers", () => {
    const catalogMax = sourcePriorityScore("some-catalog-aggregator", 1);
    const structuralMin = sourcePriorityScore("cura-definitions", 0);
    expect(UNTRACKED_FIELD_SCORE).toBeGreaterThan(catalogMax);
    expect(UNTRACKED_FIELD_SCORE).toBeLessThan(structuralMin);
  });
});
