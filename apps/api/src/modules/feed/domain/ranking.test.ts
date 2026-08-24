import { describe, expect, it } from "vitest";
import { HOT_EPOCH_SECONDS, bestScore, controversialScore, hotScore, newScore, topScore } from "./ranking.ts";

function atSeconds(epochSeconds: number): Date {
  return new Date(epochSeconds * 1000);
}

describe("bestScore", () => {
  it("ranks a small confident sample (5:0) above a larger controversial one (100:40) — карточка MF-420", () => {
    const small = bestScore(5, 0);
    const large = bestScore(100, 40);
    expect(small).toBeGreaterThan(large);
  });

  it("returns 0 for no votes at all (no confidence, not NaN)", () => {
    expect(bestScore(0, 0)).toBe(0);
  });

  it("is higher for more upvotes at the same sample size", () => {
    expect(bestScore(10, 0)).toBeGreaterThan(bestScore(5, 5));
  });

  it("is deterministic for identical inputs", () => {
    expect(bestScore(37, 12)).toBe(bestScore(37, 12));
  });
});

describe("hotScore", () => {
  it("does not let an old viral post dominate a fresh modest one — карточка MF-420", () => {
    const oldViral = hotScore(10_000, 50, atSeconds(HOT_EPOCH_SECONDS));
    // на полгода позже старта портала
    const fresh = hotScore(5, 0, atSeconds(HOT_EPOCH_SECONDS + 180 * 86400));
    expect(fresh).toBeGreaterThan(oldViral);
  });

  it("ranks more upvoted posts higher at the same timestamp", () => {
    const t = atSeconds(HOT_EPOCH_SECONDS + 3600);
    expect(hotScore(100, 0, t)).toBeGreaterThan(hotScore(10, 0, t));
  });

  it("ranks a newer post higher than an older one with identical votes", () => {
    const older = hotScore(20, 5, atSeconds(HOT_EPOCH_SECONDS));
    const newer = hotScore(20, 5, atSeconds(HOT_EPOCH_SECONDS + 86400));
    expect(newer).toBeGreaterThan(older);
  });

  it("scores a heavily downvoted post below a heavily upvoted one at the same time", () => {
    const t = atSeconds(HOT_EPOCH_SECONDS + 86400);
    const downvoted = hotScore(0, 500, t);
    const upvoted = hotScore(500, 0, t);
    expect(downvoted).toBeLessThan(upvoted);
  });

  it("is neutral (sign 0, no order contribution) when votes are tied", () => {
    const t = atSeconds(HOT_EPOCH_SECONDS);
    expect(hotScore(7, 7, t)).toBe(0);
  });

  it("is deterministic for identical inputs", () => {
    const t = atSeconds(HOT_EPOCH_SECONDS + 12345);
    expect(hotScore(42, 3, t)).toBe(hotScore(42, 3, t));
  });
});

describe("controversialScore", () => {
  it("ranks a balanced, high-volume pair above a lopsided, low-volume pair — карточка MF-420", () => {
    const balancedLarge = controversialScore(500, 480);
    const lopsidedSmall = controversialScore(10, 1);
    expect(balancedLarge).toBeGreaterThan(lopsidedSmall);
  });

  it("is 0 when all votes are one-sided", () => {
    expect(controversialScore(50, 0)).toBe(0);
    expect(controversialScore(0, 50)).toBe(0);
    expect(controversialScore(0, 0)).toBe(0);
  });

  it("is higher for a perfectly balanced pair than an unbalanced pair of the same volume", () => {
    expect(controversialScore(50, 50)).toBeGreaterThan(controversialScore(90, 10));
  });

  it("is deterministic for identical inputs", () => {
    expect(controversialScore(30, 28)).toBe(controversialScore(30, 28));
  });
});

describe("topScore", () => {
  it("is the raw vote difference", () => {
    expect(topScore(12, 5)).toBe(7);
    expect(topScore(3, 9)).toBe(-6);
    expect(topScore(0, 0)).toBe(0);
  });
});

describe("newScore", () => {
  it("orders purely by creation time", () => {
    const earlier = newScore(atSeconds(HOT_EPOCH_SECONDS));
    const later = newScore(atSeconds(HOT_EPOCH_SECONDS + 1));
    expect(later).toBeGreaterThan(earlier);
  });
});
