import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTableRefs } from "../../_boundaries/ownership.ts";
import { catalogTables } from "./catalog.tables.ts";

describe("catalog read SQL boundary", () => {
  it("declares the catalog-owned read tables used by the migrated routes", () => {
    expect([...catalogTables.owns].sort()).toEqual([
      "machine_candidates",
      "machines",
      "material_candidates",
      "material_types",
      "material_variants",
      "materials",
      "release_events",
      "vendors",
    ]);
  });

  it("keeps foreign printer and make SQL outside the catalog repository", () => {
    const source = readFileSync(fileURLToPath(new URL("./catalog-read.repository.ts", import.meta.url)), "utf8");
    const tables = new Set(extractTableRefs(source).map((reference) => reference.table));
    expect(tables.has("printers")).toBe(false);
    expect(tables.has("makes")).toBe(false);
    expect(tables.has("make_materials")).toBe(false);
    expect(tables.has("models")).toBe(false);
    expect(tables.has("users")).toBe(false);
  });
});
