import { describe, expect, it } from "vitest";
import type { UserPrinter } from "@shared/lib";
import { isCompatible } from "./compat.ts";

function model(overrides: Partial<{ craft: string }> = {}): { craft: string } {
  return { craft: "3d_printing", ...overrides };
}

const printer: UserPrinter = { id: "p1", brand: "Bambu Lab", model: "A1 mini", is_primary: true, verified: true };

describe("isCompatible (заглушка MF-33)", () => {
  it("считает совместимой любую 3D-печатную модель", () => {
    expect(isCompatible(model(), printer)).toBe(true);
  });

  it("не считает совместимой модель другого ремесла", () => {
    expect(isCompatible(model({ craft: "cnc" }), printer)).toBe(false);
  });
});
