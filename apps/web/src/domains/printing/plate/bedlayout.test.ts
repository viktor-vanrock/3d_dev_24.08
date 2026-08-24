import { describe, expect, it } from "vitest";
import { autoArrange, computeStatuses, isWithinBed, rectsOverlap, type Placement } from "./bedlayout.ts";

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: "a",
    modelId: "model-a",
    x: 0,
    y: 0,
    rotationDeg: 0,
    footprint: { width: 50, depth: 50 },
    ...overrides,
  };
}

describe("rectsOverlap", () => {
  it("не пересекаются, если разнесены дальше суммы половин по X", () => {
    const a = placement({ x: 0 });
    const b = placement({ id: "b", x: 60 });
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it("пересекаются, если центры ближе суммы половин", () => {
    const a = placement({ x: 0 });
    const b = placement({ id: "b", x: 40 });
    expect(rectsOverlap(a, b)).toBe(true);
  });

  it("учитывает поворот на 45° (SAT, не AABB-приближение)", () => {
    // Два квадрата 50×50 с центрами на расстоянии 60 по X не пересекаются как AABB,
    // но повёрнутый на 45° квадрат "растёт" по диагонали (полудиагональ ~35.4) и должен
    // задеть соседа.
    const a = placement({ x: 0, rotationDeg: 45 });
    const b = placement({ id: "b", x: 60, rotationDeg: 0 });
    expect(rectsOverlap(a, b)).toBe(true);
  });

  it("margin раздвигает порог срабатывания", () => {
    const a = placement({ x: 0 });
    const b = placement({ id: "b", x: 51 });
    expect(rectsOverlap(a, b, 0)).toBe(false);
    expect(rectsOverlap(a, b, 5)).toBe(true);
  });
});

describe("isWithinBed", () => {
  const bed = { width: 200, depth: 200 };

  it("влезает в центре стола", () => {
    expect(isWithinBed(placement({ x: 0, y: 0 }), bed)).toBe(true);
  });

  it("не влезает, если выходит за край", () => {
    expect(isWithinBed(placement({ x: 90, y: 0 }), bed)).toBe(false);
  });

  it("поворот на 90° меняет эффективный footprint по осям", () => {
    const nearEdgeItem = { x: 0, y: 85, rotationDeg: 0, footprint: { width: 50, depth: 20 } };
    expect(isWithinBed(nearEdgeItem, bed)).toBe(true);
    expect(isWithinBed({ ...nearEdgeItem, rotationDeg: 90 }, bed)).toBe(false);
  });

  it("учитывает margin у края", () => {
    const nearEdge = placement({ x: 0, y: 74, footprint: { width: 50, depth: 50 } });
    expect(isWithinBed(nearEdge, bed, 0)).toBe(true);
    expect(isWithinBed(nearEdge, bed, 2)).toBe(false);
  });
});

describe("computeStatuses", () => {
  it("флагает и коллизию, и выход за границы независимо друг от друга", () => {
    const bed = { width: 200, depth: 200 };
    const placements: Placement[] = [
      placement({ id: "a", x: 0, y: 0 }),
      placement({ id: "b", x: 20, y: 0 }), // пересекается с a
      placement({ id: "c", x: 500, y: 0 }), // далеко за столом, ни с кем не пересекается
    ];
    const statuses = computeStatuses(placements, bed);
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));
    expect(byId.a).toMatchObject({ collides: true, outOfBounds: false });
    expect(byId.b).toMatchObject({ collides: true, outOfBounds: false });
    expect(byId.c).toMatchObject({ collides: false, outOfBounds: true });
  });

  it("пустая раскладка не падает", () => {
    expect(computeStatuses([], { width: 200, depth: 200 })).toEqual([]);
  });
});

describe("autoArrange", () => {
  const bed = { width: 220, depth: 220 };

  it("ставит одиночную деталь в центр стола", () => {
    const { placements, overflowIds } = autoArrange(bed, [
      { id: "part", modelId: "model-a", footprint: { width: 51.2, depth: 34.7 } },
    ]);
    expect(overflowIds).toEqual([]);
    expect(placements).toEqual([
      expect.objectContaining({ id: "part", x: 0, y: 0, rotationDeg: 0 }),
    ]);
    expect(computeStatuses(placements, bed)).toEqual([
      expect.objectContaining({ collides: false, outOfBounds: false }),
    ]);
  });

  it("раскладывает несколько копий без пересечений и все внутри стола", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `item-${i}`,
      modelId: "model-a",
      footprint: { width: 40, depth: 40 },
    }));
    const { placements, overflowIds } = autoArrange(bed, items);
    expect(overflowIds).toEqual([]);
    expect(placements).toHaveLength(6);
    const statuses = computeStatuses(placements, bed);
    for (const status of statuses) {
      expect(status.collides).toBe(false);
      expect(status.outOfBounds).toBe(false);
    }
  });

  it("отмечает overflow для детали крупнее стола", () => {
    const items = [{ id: "huge", modelId: "model-b", footprint: { width: 500, depth: 500 } }];
    const { placements, overflowIds } = autoArrange(bed, items);
    expect(placements).toEqual([]);
    expect(overflowIds).toEqual(["huge"]);
  });

  it("переполнение стола частично: то, что не влезло, попадает в overflowIds, не теряется", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `item-${i}`,
      modelId: "model-a",
      footprint: { width: 40, depth: 40 },
    }));
    const { placements, overflowIds } = autoArrange(bed, items);
    expect(placements.length + overflowIds.length).toBe(30);
    expect(overflowIds.length).toBeGreaterThan(0);
    const statuses = computeStatuses(placements, bed);
    expect(statuses.every((s) => !s.collides && !s.outOfBounds)).toBe(true);
  });

  it("крупные детали размещаются первыми (сортировка по убыванию площади)", () => {
    const items = [
      { id: "small", modelId: "model-a", footprint: { width: 10, depth: 10 } },
      { id: "big", modelId: "model-b", footprint: { width: 100, depth: 100 } },
    ];
    const { placements } = autoArrange(bed, items);
    // "big" должен занять первую полку (минимальный x), "small" — уже после него.
    const big = placements.find((p) => p.id === "big")!;
    const small = placements.find((p) => p.id === "small")!;
    expect(big.x).toBeLessThan(small.x);
  });
});
