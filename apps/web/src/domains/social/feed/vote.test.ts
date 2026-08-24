import { describe, expect, it } from "vitest";
import { roundApproxScore, voteDelta } from "./vote.tsx";

describe("voteDelta", () => {
  it("нет голоса → апвоут: +1 up", () => {
    expect(voteDelta(0, 1)).toEqual({ up: 1, down: 0 });
  });

  it("апвоут → снятие (повторный тап): -1 up", () => {
    expect(voteDelta(1, 0)).toEqual({ up: -1, down: 0 });
  });

  it("апвоут → даунвоут (смена направления): -1 up, +1 down", () => {
    expect(voteDelta(1, -1)).toEqual({ up: -1, down: 1 });
  });

  it("даунвоут → снятие: -1 down", () => {
    expect(voteDelta(-1, 0)).toEqual({ up: 0, down: -1 });
  });
});

describe("roundApproxScore (feed.md §3 — размытый счёт первые 10 минут)", () => {
  it("маленькие числа (<10) — точные, тильда добавляется отдельно в разметке", () => {
    expect(roundApproxScore(7)).toBe(7);
    expect(roundApproxScore(0)).toBe(0);
    expect(roundApproxScore(-3)).toBe(-3);
  });

  it("округляет до ближайшего порядка величины", () => {
    expect(roundApproxScore(47)).toBe(50);
    expect(roundApproxScore(123)).toBe(100);
    expect(roundApproxScore(199)).toBe(200);
  });

  it("сохраняет знак", () => {
    expect(roundApproxScore(-47)).toBe(-50);
  });
});
