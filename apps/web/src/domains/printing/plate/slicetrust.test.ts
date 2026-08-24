import { describe, expect, it } from "vitest";
import { buildSliceRequestPayload, buildStockInput, computeDeclaredSliceKey, slugifyIdentifier } from "./slicetrust.ts";

describe("slugifyIdentifier", () => {
  it("lower-cases and replaces invalid characters", () => {
    expect(slugifyIdentifier("Bambu Lab X1 Carbon", "fallback")).toBe("bambu-lab-x1-carbon");
  });

  it("falls back when the result would not start with alnum", () => {
    expect(slugifyIdentifier("   ", "fallback")).toBe("fallback");
    expect(slugifyIdentifier("---", "fallback")).toBe("fallback");
  });

  it("accepts an already-valid identifier (e.g. a uuid) unchanged", () => {
    expect(slugifyIdentifier("d8feba54-5238-402e-a331-8149141a733a", "fallback"))
      .toBe("d8feba54-5238-402e-a331-8149141a733a");
  });
});

describe("buildStockInput", () => {
  const printer = {
    id: "printer-1",
    brand: "Creality",
    model: "Ender-3 V3 KE",
    nozzleMm: 0.4,
    kinematics: "CoreXY",
    firmwareClass: "klipper",
    buildVolume: { x: 220.4, y: 220.6, z: 250 },
  };

  it("derives every stock_input field from the printer + chosen profile", () => {
    const stock = buildStockInput(printer, "profile-abc");
    expect(stock).toEqual({
      printer_model_id: "creality-ender-3-v3-ke",
      stock_profile_id: "profile-abc",
      nozzle_diameter_um: 400,
      build_volume_mm: { x: 220, y: 221, z: 250 },
      kinematics: "corexy",
      firmware_family: "klipper",
      firmware_revision: "unknown",
    });
  });

  it("uses catalogPrinterId when present instead of slugified brand/model", () => {
    const stock = buildStockInput({ ...printer, catalogPrinterId: "abc-123" }, "profile-abc");
    expect(stock.printer_model_id).toBe("abc-123");
  });

  it("falls back to sane defaults for missing optional fields", () => {
    const stock = buildStockInput(
      { id: "printer-2", brand: "DIY", model: "Voron", nozzleMm: null, kinematics: null, firmwareClass: null, buildVolume: null },
      "profile-x",
    );
    expect(stock.nozzle_diameter_um).toBe(400);
    expect(stock.kinematics).toBe("cartesian");
    expect(stock.firmware_family).toBe("generic");
    expect(stock.build_volume_mm).toEqual({ x: 220, y: 220, z: 250 });
  });
});

describe("computeDeclaredSliceKey", () => {
  it("produces a 64-char lower-case hex digest", async () => {
    const key = await computeDeclaredSliceKey({ modelId: "m1", profileId: "p1", filamentProfileId: null, scale: 1 });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same inputs", async () => {
    const a = await computeDeclaredSliceKey({ modelId: "m1", profileId: "p1", filamentProfileId: "f1", scale: 1.5 });
    const b = await computeDeclaredSliceKey({ modelId: "m1", profileId: "p1", filamentProfileId: "f1", scale: 1.5 });
    expect(a).toBe(b);
  });

  it("differs when any identifying input changes", async () => {
    const base = { modelId: "m1", profileId: "p1", filamentProfileId: "f1", scale: 1 };
    const key = await computeDeclaredSliceKey(base);
    expect(await computeDeclaredSliceKey({ ...base, modelId: "m2" })).not.toBe(key);
    expect(await computeDeclaredSliceKey({ ...base, scale: 2 })).not.toBe(key);
    expect(await computeDeclaredSliceKey({ ...base, filamentProfileId: null })).not.toBe(key);
  });
});

describe("buildSliceRequestPayload", () => {
  it("assembles a full slice-trust.v1 request body", async () => {
    const payload = await buildSliceRequestPayload({
      modelId: "model-1",
      profileId: "profile-1",
      filamentProfileId: "filament-1",
      device: { id: "device-1", brand: "Prusa", model: "MK4", nozzleMm: 0.4, buildVolume: { x: 250, y: 210, z: 220 } },
    });
    expect(payload.profile_id).toBe("profile-1");
    expect(payload.filament_profile_id).toBe("filament-1");
    expect(payload.device_id).toBe("device-1");
    expect(payload.scale).toBe(1);
    expect(payload.slice_trust.contract_version).toBe("slice-trust.v1");
    expect(payload.slice_trust.fingerprint_source).toBe("declared");
    expect(payload.slice_trust.fingerprint_state).toBe("stock");
    expect(payload.slice_trust.slice_key).toMatch(/^[a-f0-9]{64}$/);
  });

  it("omits filament_profile_id when none is chosen", async () => {
    const payload = await buildSliceRequestPayload({
      modelId: "model-1",
      profileId: "profile-1",
      filamentProfileId: null,
      device: { id: "device-1", brand: "Prusa", model: "MK4" },
    });
    expect("filament_profile_id" in payload).toBe(false);
  });
});
