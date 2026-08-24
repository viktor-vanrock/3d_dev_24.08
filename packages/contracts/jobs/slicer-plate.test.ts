import { describe, expect, it } from "vitest";
import {
  PlateContractError,
  computeLayoutDigest,
  computePlateSliceKey,
  isBedGeometry,
  isPlateLayout,
  isProjectSliceSource,
  isSliceIntent,
  type PlateLayout,
  type SliceIntent,
} from "./slicer-plate.js";

const SOURCE = {
  model_id: "11111111-1111-1111-1111-111111111111",
  revision: "a".repeat(40),
  configuration_id: "so101-pair",
  configuration_digest: "b".repeat(64),
  workflow_step_id: "print-follower",
  artifact_id: "follower-print",
  artifact_sha256: "c".repeat(64),
};

const LAYOUT: PlateLayout = {
  bed_geometry: { shape: "rect", width_mm: 220, depth_mm: 220, origin: "center" },
  instances: [
    { instance_id: "arm-1", source: SOURCE, x_mm: 0, y_mm: 0, rotation_z_deg: 0, scale: 1 },
    { instance_id: "arm-2", source: SOURCE, x_mm: 50, y_mm: 0, rotation_z_deg: 90, scale: 1 },
  ],
  layout_snapshot_id: "snap-1",
};

const INTENT: SliceIntent = { quality: "strength", supports: "auto" };

describe("project-slice-request.v1: structural guards", () => {
  it("accepts a well-formed pinned artifact source", () => {
    expect(isProjectSliceSource(SOURCE)).toBe(true);
  });

  it.each([
    ["model_id", "not-a-uuid"],
    ["revision", "not-hex"],
    ["configuration_id", "UPPERCASE"],
    ["configuration_digest", "z".repeat(64)],
    ["artifact_sha256", "short"],
  ])("rejects a source with an invalid %s", (field, value) => {
    expect(isProjectSliceSource({ ...SOURCE, [field]: value })).toBe(false);
  });

  it("accepts rect/circle/polygon bed geometry and rejects malformed shapes", () => {
    expect(isBedGeometry({ shape: "rect", width_mm: 220, depth_mm: 220, origin: "center" })).toBe(true);
    expect(isBedGeometry({ shape: "circle", diameter_mm: 300, origin: "center" })).toBe(true);
    expect(isBedGeometry({
      shape: "polygon",
      points_mm: [[0, 0], [100, 0], [100, 100]],
      origin: "explicit",
    })).toBe(true);
    expect(isBedGeometry({ shape: "rect", origin: "center" })).toBe(false);
    expect(isBedGeometry({ shape: "circle", diameter_mm: -1, origin: "center" })).toBe(false);
    expect(isBedGeometry({ shape: "polygon", points_mm: [[0, 0]], origin: "center" })).toBe(false);
  });

  it("rejects a layout with duplicate instance_id", () => {
    const dup: PlateLayout = { ...LAYOUT, instances: [LAYOUT.instances[0]!, { ...LAYOUT.instances[0]! }] };
    expect(isPlateLayout(dup)).toBe(false);
  });

  it("rejects an empty instances array", () => {
    expect(isPlateLayout({ ...LAYOUT, instances: [] })).toBe(false);
  });

  it("accepts a well-formed layout", () => {
    expect(isPlateLayout(LAYOUT)).toBe(true);
  });

  it("validates intent quality against the shared slicer-profile quality dictionary", () => {
    expect(isSliceIntent({ supports: "off" })).toBe(true);
    expect(isSliceIntent({ quality: "speed", supports: "tree" })).toBe(true);
    expect(isSliceIntent({ quality: "invalid", supports: "off" })).toBe(false);
    expect(isSliceIntent({ supports: "invalid" })).toBe(false);
  });
});

describe("project-slice-request.v1: layout_digest / slice_key idempotency", () => {
  it("is deterministic under object key reordering", () => {
    const reordered: PlateLayout = {
      layout_snapshot_id: LAYOUT.layout_snapshot_id,
      instances: LAYOUT.instances,
      bed_geometry: { origin: "center", depth_mm: 220, width_mm: 220, shape: "rect" },
    };
    expect(computeLayoutDigest(reordered, INTENT)).toBe(computeLayoutDigest(LAYOUT, INTENT));
  });

  it("ignores instance_id (client-side label) but not position/rotation/scale/source", () => {
    const relabeled: PlateLayout = {
      ...LAYOUT,
      instances: LAYOUT.instances.map((instance, index) => ({ ...instance, instance_id: `renamed-${index}` })),
    };
    expect(computeLayoutDigest(relabeled, INTENT)).toBe(computeLayoutDigest(LAYOUT, INTENT));

    const moved: PlateLayout = {
      ...LAYOUT,
      instances: [LAYOUT.instances[0]!, { ...LAYOUT.instances[1]!, x_mm: 51 }],
    };
    expect(computeLayoutDigest(moved, INTENT)).not.toBe(computeLayoutDigest(LAYOUT, INTENT));
  });

  it("changes when intent changes", () => {
    expect(computeLayoutDigest(LAYOUT, { ...INTENT, supports: "off" })).not.toBe(computeLayoutDigest(LAYOUT, INTENT));
  });

  it("combines layout_digest with the slice-trust slice_key into one deterministic dedup key", () => {
    const layoutDigest = computeLayoutDigest(LAYOUT, INTENT);
    const trustKey = "d".repeat(64);
    const key1 = computePlateSliceKey(layoutDigest, trustKey);
    const key2 = computePlateSliceKey(layoutDigest, trustKey);
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);

    const otherLayoutDigest = computeLayoutDigest(
      { ...LAYOUT, instances: [{ ...LAYOUT.instances[0]!, x_mm: 99 }, LAYOUT.instances[1]!] },
      INTENT,
    );
    expect(computePlateSliceKey(otherLayoutDigest, trustKey)).not.toBe(key1);
  });

  it("rejects malformed hex inputs to computePlateSliceKey", () => {
    expect(() => computePlateSliceKey("not-hex", "d".repeat(64))).toThrow(PlateContractError);
    expect(() => computePlateSliceKey("d".repeat(64), "not-hex")).toThrow(PlateContractError);
  });
});
