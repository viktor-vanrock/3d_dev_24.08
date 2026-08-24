import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { DEV_LIVE_PRINTER_FIXTURES, upsertDevLivePrinterFixtures } from "./seed-dev-live-printers.ts";

describe("development live-printer fixtures", () => {
  it("covers every documented availability state with stable unique identifiers", () => {
    expect(DEV_LIVE_PRINTER_FIXTURES.map(({ key }) => key)).toEqual(["no_telemetry_channel", "printing", "paused", "error", "offline", "stale", "permission_denied"]);
    expect(new Set(DEV_LIVE_PRINTER_FIXTURES.map(({ id }) => id))).toHaveLength(DEV_LIVE_PRINTER_FIXTURES.length);
    expect(DEV_LIVE_PRINTER_FIXTURES.filter(({ expectedLiveAvailabilityReason }) => expectedLiveAvailabilityReason === "available")).toHaveLength(3);
  });

  it("is idempotent by using conflict-safe writes and never queues device commands", async () => {
    const query = vi.fn().mockImplementation((sql: string) => Promise.resolve({ rows: sql.includes("returning id") ? [{ id: "owner-id" }] : [] }));
    const pool = { query } as unknown as Pool;

    const first = await upsertDevLivePrinterFixtures(pool);
    const second = await upsertDevLivePrinterFixtures(pool);
    const statements = query.mock.calls.map(([sql]) => String(sql));

    expect(first).toEqual(second);
    expect(Object.keys(first.printerIds)).toHaveLength(7);
    expect(statements.every((sql) => !sql.includes("device_commands"))).toBe(true);
    expect(statements.filter((sql) => sql.includes("on conflict (id) do update"))).not.toHaveLength(0);
  });
});
