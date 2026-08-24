import { describe, expect, it } from "vitest";
import { recommendProfile } from "./profile-matcher.ts";
import type { BaselineProfile, FilamentInput, PrinterInput } from "./slicer-profile.ts";

const printer: PrinterInput = {
  id: "printer-1",
  nozzleDiameterMm: 0.4,
  kinematics: "corexy",
  buildVolumeMm: { x: 256, y: 256, z: 256 },
  maxNozzleTempC: 300,
  maxBedTempC: 110,
  maxPrintSpeedMmS: 180,
};

const filament: FilamentInput = { id: "filament-1", materialClass: "pla", diameterMm: 1.75 };

const base: BaselineProfile = {
  id: "base",
  profileClass: "process",
  slicer: "orcaslicer",
  name: "CoreXY base",
  machineId: "printer-1",
  materialId: null,
  inheritsId: null,
  params: { kinematics: "corexy", nozzle_diameter_mm: 0.4, print_speed_mm_s: 200, nozzle_temperature_c: 220 },
  sourceName: "OrcaSlicer",
  sourceUrl: null,
  sourceRef: "test",
  license: "AGPL-3.0-or-later",
  confidence: 1,
  extrapolatedFromId: null,
};

describe("slicer profile matching", () => {
  it("applies a material delta and intent, then clamps unsafe values to the printer passport", () => {
    const overlay: BaselineProfile = {
      ...base,
      id: "overlay",
      profileClass: "filament",
      machineId: null,
      materialId: "filament-1",
      params: {
        nozzle_temperature_c: 310,
        intent_overrides: { strength: { print_speed_mm_s: 150 } },
      },
    };

    const recommendation = recommendProfile(printer, filament, [base, overlay], "strength");

    expect(recommendation).toMatchObject({
      confidence: 1,
      extrapolated: false,
      params: { print_speed_mm_s: 150, nozzle_temperature_c: 300 },
      origin: { base_profile_id: "base", overlay_profile_ids: ["overlay"] },
    });
    expect(recommendation?.origin.changed_fields.some(({ reason }) => reason.includes("материала"))).toBe(true);
    expect(recommendation?.origin.changed_fields.some(({ reason }) => reason.includes("паспортом"))).toBe(true);
  });

  it("returns null when no process or machine baseline exists", () => {
    expect(recommendProfile(printer, filament, [{ ...base, profileClass: "filament" }], "appearance")).toBeNull();
  });
});
