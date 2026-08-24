import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { DEV_PRINTERS } from "./seed-dev-printers.ts";
import { upsertDevPrinters } from "./seed-dev-printers.ts";

describe("dev-каталог принтеров", () => {
  it("публикует канонический firmware-pilot.v1 факт для обеих целевых моделей", () => {
    expect(DEV_PRINTERS).toEqual([
      expect.objectContaining({
        slug: "creality.ender-3-v3-ke",
        brand: "Creality",
        model: "Ender-3 V3 KE",
        pilot_status: {
          status: "reported",
          stage: "not_started",
          updated_at: "2026-07-12T00:00:00Z",
          freshness: "stale",
          source: "fleet",
          confidence: "limited",
        },
      }),
      expect.objectContaining({
        slug: "flsun.v400",
        brand: "FLSun",
        model: "V400",
        pilot_status: {
          status: "reported",
          stage: "not_started",
          updated_at: "2026-07-11T00:00:00Z",
          freshness: "stale",
          source: "fleet",
          confidence: "limited",
        },
      }),
    ]);
    expect(JSON.stringify(DEV_PRINTERS)).not.toMatch(/lan_endpoint|\bip\b|serial|token|credential|command/i);
  });

  it("не затирает подтверждённый pilot_status при повторном seed", async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
    } as unknown as Pool;

    await upsertDevPrinters(db);

    expect(queries).toHaveLength(2);
    for (const sql of queries) {
      expect(sql).toContain("pilot_status");
      expect(sql).toContain("pilot_status = coalesce(printers.pilot_status, excluded.pilot_status)");
    }
  });
});
