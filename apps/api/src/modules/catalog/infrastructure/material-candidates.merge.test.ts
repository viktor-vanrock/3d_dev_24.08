import { describe, expect, it } from "vitest";
import { parseMaterialCandidateRaw, parseSpoolmanRaw, parseUserSuggestionRaw } from "./material-candidates.merge.ts";

const BASE_RAW = {
  manufacturer: "Polymaker",
  manufacturer_slug: "polymaker",
  material: "PLA",
  name: "{color_name} PolyTerra PLA",
  name_template: "{color_name} PolyTerra PLA",
  density: 1.24,
  diameter_mm: 1.75,
  color_name: "Charcoal Black",
  color_hex: "1a1a1a",
  color_hexes: ["1A1A1A", "202020"],
  weights: [1000, 250],
  extruder_temp: 210,
  bed_temp: 55,
  finish: "matte",
  translucent: false,
  glow: false,
  pattern: null,
  multi_color_direction: undefined,
};

describe("parseSpoolmanRaw", () => {
  it("maps a well-formed spoolman raw candidate into vendor/type/material/variant fields", () => {
    const parsed = parseSpoolmanRaw(BASE_RAW);
    expect(parsed).toEqual({
      vendorSlug: "polymaker",
      vendorName: "Polymaker",
      materialTypeSlug: "pla",
      materialTypeName: "PLA",
      materialSlug: "polyterra-pla",
      materialName: "PolyTerra PLA",
      materialSpecs: { density: 1.24, extruder_temp: 210, bed_temp: 55 },
      colorName: "Charcoal Black",
      colorHex: "#1a1a1a",
      diameterMm: 1.75,
      weightG: 1000,
      variantSpecs: { finish: "matte", translucent: false, glow: false },
    });
  });

  it("collapses a pure-color name template to the material type (no distinct product line)", () => {
    const parsed = parseSpoolmanRaw({ ...BASE_RAW, name: "{color_name}", name_template: "{color_name}" });
    expect(parsed?.materialSlug).toBe("pla");
    expect(parsed?.materialName).toBe("PLA");
  });

  it("falls back to color_hexes when color_hex is missing, normalizing case", () => {
    const parsed = parseSpoolmanRaw({ ...BASE_RAW, color_hex: undefined, color_hexes: ["ABCDEF"] });
    expect(parsed?.colorHex).toBe("#abcdef");
  });

  it("drops an unparseable hex instead of letting the DB constraint reject it", () => {
    const parsed = parseSpoolmanRaw({ ...BASE_RAW, color_hex: "not-a-hex", color_hexes: [] });
    expect(parsed?.colorHex).toBeNull();
  });

  it("rounds the first weight entry and ignores the rest", () => {
    const parsed = parseSpoolmanRaw({ ...BASE_RAW, weights: [999.6, 250] });
    expect(parsed?.weightG).toBe(1000);
  });

  it("returns null when a required field is missing or invalid", () => {
    expect(parseSpoolmanRaw({ ...BASE_RAW, manufacturer: "" })).toBeNull();
    expect(parseSpoolmanRaw({ ...BASE_RAW, material: undefined })).toBeNull();
    expect(parseSpoolmanRaw({ ...BASE_RAW, color_name: null })).toBeNull();
    expect(parseSpoolmanRaw({ ...BASE_RAW, diameter_mm: "not-a-number" })).toBeNull();
    expect(parseSpoolmanRaw({ ...BASE_RAW, diameter_mm: 0 })).toBeNull();
    expect(parseSpoolmanRaw("not-an-object")).toBeNull();
    expect(parseSpoolmanRaw(null)).toBeNull();
  });

  it("canonicalizes known vendor spelling variants via resolveVendorName", () => {
    const parsed = parseSpoolmanRaw({ ...BASE_RAW, manufacturer: "Prusa3D", manufacturer_slug: "prusa3d" });
    expect(parsed).toMatchObject({ vendorSlug: "prusa-research", vendorName: "Prusa Research" });
  });
});

describe("parseUserSuggestionRaw", () => {
  const USER_RAW = { vendor: "REC", material_type: "PLA", color_name: "Черный", notes: "с ozon" };

  it("canonicalizes a known single-word RU color to the EN taxonomy used by bootstrap imports", () => {
    // MF-1902: без этого "Предложить филамент" писал сырую кириллицу в material_variants.color_name,
    // и точный/подстрочный ilike у GET /materials?color= не находил её по латинскому вводу.
    const parsed = parseUserSuggestionRaw(USER_RAW);
    expect(parsed?.colorName).toBe("Black");
  });

  it("leaves a compound or unrecognized color name untouched (only /materials substring match covers it)", () => {
    const parsed = parseUserSuggestionRaw({ ...USER_RAW, color_name: "Чёрный сатин" });
    expect(parsed?.colorName).toBe("Чёрный сатин");
  });

  it("passes through an already-English color name unchanged", () => {
    const parsed = parseUserSuggestionRaw({ ...USER_RAW, color_name: "Black" });
    expect(parsed?.colorName).toBe("Black");
  });
});

describe("parseMaterialCandidateRaw", () => {
  it("dispatches spoolman source to parseSpoolmanRaw", () => {
    expect(parseMaterialCandidateRaw("spoolman", BASE_RAW)).not.toBeNull();
  });

  it("returns null for an unknown source (no adapter to parse its raw shape)", () => {
    expect(parseMaterialCandidateRaw("some-future-source", BASE_RAW)).toBeNull();
  });
});
