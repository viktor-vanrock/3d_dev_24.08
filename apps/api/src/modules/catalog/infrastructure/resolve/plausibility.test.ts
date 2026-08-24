import { describe, expect, it } from "vitest";
import { checkPlausibility } from "./plausibility.ts";

describe("checkPlausibility", () => {
  it("passes a sane build_volume/temps/kinematics", () => {
    const result = checkPlausibility({
      build_volume: { x: 220, y: 220, z: 250, shape: "rectangular" },
      max_nozzle_temp_c: 300,
      max_bed_temp_c: 110,
      kinematics: "corexy",
    });
    expect(result).toEqual({ plausible: true, reasons: [] });
  });

  it("passes specs with no build_volume at all (nothing to check)", () => {
    expect(checkPlausibility({ kinematics: "delta" })).toEqual({ plausible: true, reasons: [] });
    expect(checkPlausibility({})).toEqual({ plausible: true, reasons: [] });
  });

  it("flags an absurd build_volume (typo'd extra digit)", () => {
    const result = checkPlausibility({ build_volume: { x: 220, y: 220, z: 25000 } });
    expect(result.plausible).toBe(false);
    expect(result.reasons[0]).toMatch(/build_volume\.z/);
  });

  it("flags a zero or negative dimension", () => {
    expect(checkPlausibility({ build_volume: { x: 0, y: 220, z: 250 } }).plausible).toBe(false);
    expect(checkPlausibility({ build_volume: { x: -10, y: 220, z: 250 } }).plausible).toBe(false);
  });

  it("flags absurd temps", () => {
    expect(checkPlausibility({ max_nozzle_temp_c: 5000 }).plausible).toBe(false);
    expect(checkPlausibility({ max_bed_temp_c: -5 }).plausible).toBe(false);
  });

  it("flags an empty kinematics string", () => {
    expect(checkPlausibility({ kinematics: "  " }).plausible).toBe(false);
  });
});
