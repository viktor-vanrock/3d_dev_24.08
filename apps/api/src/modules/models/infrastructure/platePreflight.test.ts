import { describe, expect, it } from "vitest";
import { computePlatePreflight, DEFAULT_PLATE_CLEARANCE_MM } from "./platePreflight.ts";
import type { BedGeometry } from "@portal/contracts/jobs/slicer-plate";

const RECT_BED: BedGeometry = { shape: "rect", width_mm: 220, depth_mm: 220, origin: "center" };
const FOOTPRINT = { x: 40, y: 20, z: 30 };

describe("computePlatePreflight", () => {
  it("returns unsupported_geometry for every instance when the footprint is unknown", () => {
    const result = computePlatePreflight(RECT_BED, [{ instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 }], null, 250);
    expect(result.ok).toBe(false);
    expect(result.instances[0]).toMatchObject({ instance_id: "a", ok: false, codes: ["unsupported_geometry"] });
  });

  it("passes a single well-placed instance with margin", () => {
    const result = computePlatePreflight(RECT_BED, [{ instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 }], FOOTPRINT, 250);
    expect(result).toEqual({ ok: true, instances: [{ instance_id: "a", ok: true, codes: [] }] });
  });

  it("flags outside_bed when the instance footprint crosses the bed boundary", () => {
    const result = computePlatePreflight(RECT_BED, [{ instance_id: "a", x_mm: 105, y_mm: 0, rotation_z_deg: 0, scale: 1 }], FOOTPRINT, 250);
    expect(result.ok).toBe(false);
    expect(result.instances[0]!.codes).toContain("outside_bed");
  });

  it("flags height_exceeded when scaled Z exceeds the build volume", () => {
    const result = computePlatePreflight(RECT_BED, [{ instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 }], FOOTPRINT, 20);
    expect(result.instances[0]!.codes).toContain("height_exceeded");
  });

  it("flags collision for overlapping instances and clearance_failed for too-close (non-overlapping) ones", () => {
    const colliding = computePlatePreflight(
      RECT_BED,
      [
        { instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 },
        { instance_id: "b", x_mm: 10, y_mm: 0, rotation_z_deg: 0, scale: 1 },
      ],
      FOOTPRINT,
      250,
    );
    expect(colliding.instances.find((i) => i.instance_id === "a")!.codes).toContain("collision");
    expect(colliding.instances.find((i) => i.instance_id === "a")!.collides_with).toEqual(["b"]);

    const tooClose = computePlatePreflight(
      RECT_BED,
      [
        { instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 },
        { instance_id: "b", x_mm: 40 + DEFAULT_PLATE_CLEARANCE_MM / 2, y_mm: 0, rotation_z_deg: 0, scale: 1 },
      ],
      FOOTPRINT,
      250,
    );
    const aResult = tooClose.instances.find((i) => i.instance_id === "a")!;
    expect(aResult.codes).toContain("clearance_failed");
    expect(aResult.codes).not.toContain("collision");

    const wellSpaced = computePlatePreflight(
      RECT_BED,
      [
        { instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 },
        { instance_id: "b", x_mm: 40 + DEFAULT_PLATE_CLEARANCE_MM + 1, y_mm: 0, rotation_z_deg: 0, scale: 1 },
      ],
      RECT_BED.shape === "rect" ? FOOTPRINT : FOOTPRINT,
      250,
    );
    expect(wellSpaced.instances.every((i) => i.ok)).toBe(true);
  });

  it("accounts for rotation when computing the axis-aligned bounding box", () => {
    // A 40x20 footprint rotated 90deg becomes 20x40 — fits a spot that a 40-wide box would not.
    const bed: BedGeometry = { shape: "rect", width_mm: 30, depth_mm: 50, origin: "center" };
    const rotated = computePlatePreflight(bed, [{ instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 90, scale: 1 }], FOOTPRINT, 250);
    expect(rotated.instances[0]!.ok).toBe(true);

    const unrotated = computePlatePreflight(bed, [{ instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 }], FOOTPRINT, 250);
    expect(unrotated.instances[0]!.codes).toContain("outside_bed");
  });

  it("flags outside_bed for a footprint inside the bed rect but overlapping an excluded zone", () => {
    const bed: BedGeometry = {
      shape: "rect",
      width_mm: 220,
      depth_mm: 220,
      origin: "center",
      excluded_zones_mm: [{ x_mm: -10, y_mm: -10, width_mm: 20, depth_mm: 20 }],
    };
    const result = computePlatePreflight(bed, [{ instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 }], FOOTPRINT, 250);
    expect(result.instances[0]!.codes).toContain("outside_bed");
  });

  it("supports circle beds", () => {
    const bed: BedGeometry = { shape: "circle", diameter_mm: 100, origin: "center" };
    const inside = computePlatePreflight(bed, [{ instance_id: "a", x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 }], FOOTPRINT, 250);
    expect(inside.instances[0]!.ok).toBe(true);

    const outside = computePlatePreflight(bed, [{ instance_id: "a", x_mm: 40, y_mm: 40, rotation_z_deg: 0, scale: 1 }], FOOTPRINT, 250);
    expect(outside.instances[0]!.codes).toContain("outside_bed");
  });
});
