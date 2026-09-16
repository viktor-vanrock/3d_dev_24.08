import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { loadMachines, machineContentHash, publicPrinterType } from "./forge-catalog/machines.ts";
import { loadMaterials, snapshotMaterialKind } from "./forge-catalog/materials.ts";
import { importNews, loadNews } from "./forge-catalog/news.ts";
import { loadOfdMaterials } from "./forge-catalog/ofd-materials.ts";
import { loadHistory } from "./forge-catalog/history.ts";
import { importEnrichment } from "./forge-catalog/enrichment.ts";
import { parseOptions } from "./import-forge-catalog.ts";

const snapshot = new URL("../../../migration/forge-catalog", import.meta.url).pathname;

describe("forge catalog snapshot", () => {
  it("parses CLI in safe dry-run mode by default", () => {
    const options = parseOptions(["--source-dir", snapshot, "--sections", "machines"]);
    expect(options.apply).toBe(false);
    expect([...options.sections]).toEqual(["machines"]);
    expect(options.newsStatus).toBe("draft");
  });

  it("requires an explicit valid news publication status", () => {
    expect(parseOptions(["--source-dir", snapshot, "--news-status", "visible"]).newsStatus).toBe("visible");
    expect(() => parseOptions(["--source-dir", snapshot, "--news-status", "published"])).toThrow("--news-status");
  });

  it("keeps community optional in CLI options", () => {
    const options = parseOptions(["--source-dir", snapshot, "--sections", "news", "--author-id", "00000000-0000-0000-0000-000000000001"]);
    expect(options.authorId).toBe("00000000-0000-0000-0000-000000000001");
    expect(options.communityId).toBeNull();
  });

  it("accepts the complete catalog section set", () => {
    expect([...parseOptions(["--source-dir", snapshot, "--sections", "machines,materials,ofd,history,enrichment"]).sections]).toEqual(["machines", "materials", "ofd", "history", "enrichment"]);
  });

  it("validates every machine card", async () => {
    const loaded = await loadMachines(snapshot);
    expect(loaded.records).toHaveLength(296);
    expect(loaded.rejected).toBe(0);
  });

  it("changes the machine content hash when specs change", async () => {
    const loaded = await loadMachines(snapshot);
    const machine = loaded.records[0];
    expect(machine).toBeDefined();
    if (!machine) return;
    const changed = { ...machine, specs: { ...machine.specs, max_speed_mms: 123 } };
    expect(machineContentHash(changed).equals(machineContentHash(machine))).toBe(false);
    expect(machineContentHash(machine).equals(machineContentHash(machine))).toBe(true);
  });

  it("projects only 3D printers into the public printer catalog", () => {
    expect(publicPrinterType("fdm_printer")).toBe("fdm");
    expect(publicPrinterType("sla_printer")).toBe("resin-sla");
    expect(publicPrinterType("cnc_router")).toBeNull();
    expect(publicPrinterType("cnc_lathe")).toBeNull();
    expect(publicPrinterType("laser_cutter")).toBeNull();
  });

  it("keeps every valid material row as static data", async () => {
    const loaded = await loadMaterials(snapshot);
    expect(loaded.found).toBe(899);
    expect(loaded.records).toHaveLength(899);
    expect(loaded.rejected).toBe(0);
  });

  it("loads the complete OFD catalog including Bambu Lab", async () => {
    const loaded = await loadOfdMaterials(snapshot);
    expect(loaded.records).toHaveLength(2058);
    expect(loaded.rejected).toBe(0);
    expect(loaded.records.filter((record) => record.vendor.slug === "bambu-lab")).toHaveLength(49);
  });

  it("loads all historical machines", async () => {
    const loaded = await loadHistory(snapshot);
    expect(loaded.records).toHaveLength(39);
    expect(loaded.rejected).toBe(0);
  });

  it("reports every enrichment record in dry-run", async () => {
    const report = await importEnrichment(null, snapshot);
    expect(report.found).toBe(1277);
    expect(report.unchanged).toBe(1277);
  });

  it("accepts only filament snapshots until other mappings exist", () => {
    expect(snapshotMaterialKind(undefined)).toBe("filament");
    expect(snapshotMaterialKind("filament")).toBe("filament");
    expect(snapshotMaterialKind("resin")).toBeNull();
    expect(snapshotMaterialKind("aluminum")).toBeNull();
  });

  it("validates all news records", async () => {
    const loaded = await loadNews(snapshot);
    expect(loaded.records).toHaveLength(1881);
    expect(loaded.rejected).toBe(0);
  });

  it("serializes and skips a repeated news import without community", async () => {
    const statements: string[] = [];
    const parameters: Array<readonly unknown[]> = [];
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      statements.push(sql);
      parameters.push(values ?? []);
      if (sql.includes("select 1 from feed_posts")) return { rows: [{ exists: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query } as unknown as PoolClient;

    const report = await importNews(client, snapshot, "00000000-0000-0000-0000-000000000001", null, "visible");

    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements.filter((sql) => sql.includes("insert into feed_posts"))).toHaveLength(0);
    expect(statements.filter((sql) => sql.includes("select 1 from feed_posts"))).toHaveLength(1881);
    expect(parameters[1]).toEqual([expect.stringMatching(/^sha256:/), null]);
    expect(report.inserted).toBe(0);
    expect(report.unchanged).toBe(1881);
  });
});
