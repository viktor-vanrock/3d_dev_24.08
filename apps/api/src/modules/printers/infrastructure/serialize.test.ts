import { describe, expect, it } from "vitest";
import { serializePilotStatus } from "./pilot.ts";
import { serializeCatalogCapabilities, serializePrinter, type PrinterRow } from "./serialize.ts";

describe("serializePrinter firmware pilot", () => {
  it("publishes a contract-safe pilot status for the exact model", () => {
    const printer = serializePrinter(
      {
        slug: "creality.ender-3-v3-ke",
        pilot_status: {
          status: "reported",
          stage: "building",
          updated_at: "2026-07-15T00:00:00Z",
          freshness: "fresh",
          source: "fleet",
          confidence: "limited",
        },
      } as unknown as PrinterRow,
      new Date("2026-07-15T12:00:00Z"),
    );

    expect(printer.pilot_status).toEqual({
      status: "reported",
      stage: "building",
      updated_at: "2026-07-15T00:00:00Z",
      freshness: "fresh",
      source: "fleet",
      confidence: "limited",
    });
  });

  it("publishes explicit no_data when Fleet has no confirmed fact", () => {
    const printer = serializePrinter({} as PrinterRow);

    expect(printer.pilot_status).toEqual({ status: "no_data" });
  });

  it("computes stale from updated_at and rejects unsafe or unverified ready facts", () => {
    expect(
      serializePilotStatus(
        {
          status: "reported",
          stage: "building",
          updated_at: "2026-07-13T11:59:59Z",
          freshness: "fresh",
          source: "fleet",
          confidence: "limited",
        },
        new Date("2026-07-15T12:00:00Z"),
      ),
    ).toMatchObject({ status: "reported", freshness: "stale" });

    expect(
      serializePilotStatus({
        status: "reported",
        stage: "ready",
        updated_at: "2026-07-15T00:00:00Z",
        freshness: "fresh",
        source: "fleet",
        confidence: "limited",
      }),
    ).toEqual({ status: "no_data" });

    expect(
      serializePilotStatus({
        status: "reported",
        stage: "building",
        updated_at: "2026-07-15T00:00:00Z",
        freshness: "fresh",
        source: "fleet",
        confidence: "limited",
        lan_endpoint: "http://192.0.2.1",
      }),
    ).toEqual({ status: "no_data" });
  });
});

describe("serializePrinter capability contract", () => {
  it("normalizes legacy fields, drops unknown capability data and produces deterministic JSON", () => {
    const row = {
      id: "printer-1",
      slug: "fixture.capability",
      brand: " Fixture ",
      model: " Capability ",
      aliases: ["Beta", " alpha ", "Beta", 42],
      released_at: null,
      status: "shipping",
      kinematics: null,
      type: "fdm",
      enclosed: null,
      build_volume_x: "220",
      build_volume_y: 220,
      build_volume_z: 250,
      hotend_max_temp_c: "300",
      hotend_max_flow_mm3s: null,
      hotend_hardened: true,
      bed_max_temp_c: 100,
      bed_auto_leveling: "strain-gauge",
      multimaterial_supported: false,
      has_laser: true,
      has_cnc: false,
      nozzle_swappable: true,
      moonraker: true,
      lan_mode: false,
      price_msrp_usd: "499",
      price_ru_rub: "45000",
      price_ru_updated_at: "2026-07-16",
      support_level: "list",
      firmware_ready: false,
      firmware_public: false,
      connector_type: null,
      firmware_repo: null,
      pilot_status: null,
      specs: {
        build_volume: { unexpected: "drop", z: "not-a-number", shape: "rect", x: 235 },
        hotend: { material: " hardened steel ", unknown: true },
        multimaterial: { supported: "yes", system_name: " AMS ", max_colors: 4 },
        toolhead_extras: [
          { spec: " 10W ", kind: "laser", unsafe: "drop" },
          { kind: "prototype", spec: "drop" },
        ],
        connectivity: { moonraker: "not-bool", wifi: true, vendor_token: "drop" },
        materials_supported: ["PETG", " PLA ", "PETG", 7],
        unique_features: [" Enclosure ", "Enclosure", null],
        price: { ru_rub: "not-a-number", msrp_usd: 500, ignored: "drop" },
      },
      media: { gallery: ["b", "a", "a", 1], hero: " hero.webp ", internal_url: "drop" },
      sources: ["https://b.example", " https://a.example ", "https://b.example", ""],
      field_provenance: { z: { source_url: "https://z.example" }, a: { source_url: "https://a.example" } },
      confidence: "high",
      filled_by: "researcher",
      reviewed_by: null,
      gaps: [" price ", "price", ""],
      verified: true,
      schema_version: "1.0",
      created_at: "2026-07-16T00:00:00Z",
      updated_at: "2026-07-16T00:00:00Z",
    } as unknown as PrinterRow;

    const serialized = serializePrinter(row);

    expect(serialized.aliases).toEqual(["alpha", "Beta"]);
    expect(serialized.build_volume).toEqual({ x: 235, y: 220, z: 250, shape: "rect", diameter: null });
    expect(serialized.hotend).toEqual({ max_temp_c: 300, max_flow_mm3s: null, nozzle_default_mm: null, nozzle_swappable: true, material: "hardened steel", hardened: true });
    expect(serialized.multimaterial).toEqual({ supported: false, system_name: "AMS", max_colors: 4, unique_notes: null });
    expect(serialized.toolhead_extras).toEqual([{ kind: "laser", spec: "10W" }]);
    expect(serialized.connectivity).toEqual({ wifi: true, ethernet: null, usb: null, camera: null, firmware: null, moonraker: true, lan_mode: false });
    expect(serialized.materials_supported).toEqual(["PETG", "PLA"]);
    expect(serialized.price).toEqual({ msrp_usd: 500, ru_rub: 45000, ru_updated_at: "2026-07-16" });
    expect(serialized.unique_features).toEqual(["Enclosure"]);
    expect(serialized.media).toEqual({ hero: "hero.webp", gallery: ["a", "b"], official_url: null });
    expect(serialized.sources).toEqual(["https://a.example", "https://b.example"]);
    expect(serialized._meta.gaps).toEqual(["price"]);
    expect(serializeCatalogCapabilities({ ...row, bed_auto_leveling: "none" })).toEqual(["laser", "hardened", "moonraker"]);
    expect(JSON.stringify(serialized)).toBe(
      JSON.stringify(
        serializePrinter({
          ...row,
          specs: {
            price: { ignored: "drop", msrp_usd: 500, ru_rub: "not-a-number" },
            unique_features: [null, "Enclosure", " Enclosure "],
            materials_supported: [7, "PETG", " PLA ", "PETG"],
            connectivity: { vendor_token: "drop", wifi: true, moonraker: "not-bool" },
            toolhead_extras: [
              { unsafe: "drop", kind: "laser", spec: " 10W " },
              { spec: "drop", kind: "prototype" },
            ],
            multimaterial: { max_colors: 4, system_name: " AMS ", supported: "yes" },
            hotend: { unknown: true, material: " hardened steel " },
            build_volume: { x: 235, shape: "rect", z: "not-a-number", unexpected: "drop" },
          },
        } as PrinterRow),
      ),
    );
  });
});
