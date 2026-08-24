import { describe, expect, it } from "vitest";
import {
  PRINTER_CATALOG_CONTRACT_VERSION,
  PRINTER_CATALOG_PAGE_LIMIT,
  PRINTER_CATALOG_SORTS,
  isPrinterCatalogPage,
} from "./printers.js";

describe("printer catalog HTTP contract", () => {
  it("requires an opaque cursor only together with the original query and a continuation page", () => {
    expect(PRINTER_CATALOG_CONTRACT_VERSION).toBe("printers.catalog.v1");
    expect(PRINTER_CATALOG_PAGE_LIMIT).toBe(24);
    expect(PRINTER_CATALOG_SORTS).toContain("recommended");

    expect(
      isPrinterCatalogPage({
        contract_version: "printers.catalog.v1",
        items: [
          {
            id: "9be4e7f8-f916-4f89-a1fb-7da4c87c33fd",
            slug: "creality.k1-max",
            brand: "Creality",
            model: "K1 Max",
            status: "shipping",
            verified: true,
            image_url: null,
            price: { rub: 54900, usd: 599, rub_updated_at: "2026-07-15" },
            build_volume_mm: { x: 300, y: 300, z: 300 },
            kinematics: "corexy",
            capabilities: ["enclosed"],
          },
        ],
        has_more: true,
        next_cursor: "opaque-cursor-not-decoded-by-web",
        gap_counts: { ams: 2 },
      }),
    ).toBe(true);
  });

  it("rejects a page whose has_more and next_cursor disagree", () => {
    expect(
      isPrinterCatalogPage({
        contract_version: "printers.catalog.v1",
        items: [],
        has_more: true,
        next_cursor: null,
        gap_counts: {},
      }),
    ).toBe(false);
  });
});
