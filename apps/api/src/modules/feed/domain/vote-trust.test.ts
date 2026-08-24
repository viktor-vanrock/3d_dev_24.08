import { afterEach, describe, expect, it } from "vitest";
import { voteTrustWeight } from "./vote-trust.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

afterEach(() => {
  delete process.env.FEED_GATE_MIN_AGE_FOR_FULL_TRUST_DAYS;
});

describe("voteTrustWeight", () => {
  it("даёт базовый вес по trust_level для аккаунта старше порога полного доверия", () => {
    expect(voteTrustWeight({ trustLevel: 0, createdAt: daysAgo(30) })).toBeCloseTo(0.3);
    expect(voteTrustWeight({ trustLevel: 1, createdAt: daysAgo(30) })).toBeCloseTo(0.55);
    expect(voteTrustWeight({ trustLevel: 2, createdAt: daysAgo(30) })).toBeCloseTo(0.8);
    expect(voteTrustWeight({ trustLevel: 3, createdAt: daysAgo(30) })).toBe(1);
    expect(voteTrustWeight({ trustLevel: 4, createdAt: daysAgo(30) })).toBe(1);
  });

  it("клэмпит TL3/TL4 до 0.5, если аккаунт младше FEED_GATE_MIN_AGE_FOR_FULL_TRUST_DAYS (default 7)", () => {
    expect(voteTrustWeight({ trustLevel: 3, createdAt: daysAgo(1) })).toBe(0.5);
    expect(voteTrustWeight({ trustLevel: 4, createdAt: daysAgo(6) })).toBe(0.5);
  });

  it("клэмп не понижает TL0 — его базовый вес уже ниже 0.5", () => {
    expect(voteTrustWeight({ trustLevel: 0, createdAt: daysAgo(0) })).toBeCloseTo(0.3);
  });

  it("клэмп понижает TL1 у свежего аккаунта — его базовый вес (0.55) выше 0.5", () => {
    expect(voteTrustWeight({ trustLevel: 1, createdAt: daysAgo(0) })).toBe(0.5);
  });

  it("граница: ровно на пороге возраста уже не клэмпится (< порог, не <=)", () => {
    expect(voteTrustWeight({ trustLevel: 3, createdAt: daysAgo(7) })).toBe(1);
  });

  it("уважает переопределённый FEED_GATE_MIN_AGE_FOR_FULL_TRUST_DAYS", () => {
    process.env.FEED_GATE_MIN_AGE_FOR_FULL_TRUST_DAYS = "1";
    expect(voteTrustWeight({ trustLevel: 3, createdAt: daysAgo(2) })).toBe(1);
    expect(voteTrustWeight({ trustLevel: 3, createdAt: daysAgo(0) })).toBe(0.5);
  });

  it("клэмпит trust_level вне [0,4] до границ диапазона", () => {
    expect(voteTrustWeight({ trustLevel: -1, createdAt: daysAgo(30) })).toBeCloseTo(0.3);
    expect(voteTrustWeight({ trustLevel: 9, createdAt: daysAgo(30) })).toBe(1);
  });
});
