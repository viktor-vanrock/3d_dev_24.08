import { describe, expect, it } from "vitest";
import { InvalidPrinterCatalogQueryError, fingerprintPrinterCatalogQuery, normalizePrinterCatalogQuery } from "./query.ts";

describe("printer catalog query normalization", () => {
  it("sorts and deduplicates every multi-value filter before fingerprinting", () => {
    const left = normalizePrinterCatalogQuery({
      brand: " Bambu-Lab, Creality, bambu-lab ",
      type: "fdm,resin-lcd",
      kinematics: "corexy, cartesian",
      status: "shipping,announced",
      capabilities: "enclosed,ams",
      materials: "PETG, PLA, petg",
      connectivity: "wifi,ethernet",
      support_level: "managed,list",
    });
    const right = normalizePrinterCatalogQuery({
      brand: "creality,bambu-lab",
      type: "resin-lcd,fdm",
      kinematics: "cartesian,corexy",
      status: "announced,shipping",
      capabilities: "ams,enclosed",
      materials: "pla,petg",
      connectivity: "ethernet,wifi",
      support_level: "list,managed",
    });

    expect(left).toEqual(right);
    expect(fingerprintPrinterCatalogQuery(left)).toBe(fingerprintPrinterCatalogQuery(right));
  });

  it.each([
    ["q", "needle"],
    ["brand", "creality"],
    ["type", "fdm"],
    ["kinematics", "corexy"],
    ["status", "shipping"],
    ["capabilities", "ams"],
    ["materials", "pla"],
    ["connectivity", "wifi"],
    ["support_level", "managed"],
    ["price_min", "100"],
    ["price_max", "200"],
    ["fits_x", "200"],
    ["fits_y", "200"],
    ["fits_z", "200"],
    ["hotend_min", "280"],
    ["bed_min", "100"],
    ["flow_min", "20"],
    ["speed_min", "200"],
    ["swappable_nozzle", "1"],
    ["sort", "price_desc"],
    ["currency", "usd"],
    ["limit", "12"],
  ] as const)("changes fingerprint when %s changes", (field, value) => {
    const base = normalizePrinterCatalogQuery({});
    const changed = normalizePrinterCatalogQuery({ [field]: value });
    expect(fingerprintPrinterCatalogQuery(changed)).not.toBe(fingerprintPrinterCatalogQuery(base));
  });

  it("normalizes relevant to recommended without a search and preserves it with a search", () => {
    expect(normalizePrinterCatalogQuery({ sort: "relevant" }).sort).toBe("recommended");
    expect(normalizePrinterCatalogQuery({ q: "  K1  ", sort: "relevant" })).toMatchObject({ q: "k1", sort: "relevant" });
  });

  it("preserves null semantics for optional numbers and boolean filters", () => {
    const query = normalizePrinterCatalogQuery({ price_min: "0", price_max: "", swappable_nozzle: "0" });

    expect(query).toMatchObject({ price_min: 0, price_max: null, swappable_nozzle: false });
    expect(fingerprintPrinterCatalogQuery(normalizePrinterCatalogQuery({}))).not.toBe(fingerprintPrinterCatalogQuery(query));
  });

  it.each([
    [{ q: "x".repeat(201) }, "q"],
    [{ currency: "eur" }, "currency"],
    [{ sort: "unknown" }, "sort"],
    [{ capabilities: "prototype" }, "capabilities"],
    [{ limit: "0" }, "limit"],
    [{ price_min: "10", price_max: "9" }, "price_min"],
    [{ ams: "yes" }, "ams"],
  ] as const)("rejects invalid %s", (input, field) => {
    expect(() => normalizePrinterCatalogQuery(input)).toThrowError(InvalidPrinterCatalogQueryError);
    try {
      normalizePrinterCatalogQuery(input);
    } catch (error) {
      expect((error as InvalidPrinterCatalogQueryError).field).toBe(field);
    }
  });
});
