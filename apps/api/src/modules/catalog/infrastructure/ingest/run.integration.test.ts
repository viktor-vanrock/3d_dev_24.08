import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "../../../../db/client.ts";
import { runIngest } from "./run.ts";
import type { RawCandidate, SourceAdapter } from "./types.ts";

function isPortalTestDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  if (url === undefined) return false;
  try {
    return new URL(url).pathname.slice(1) === "portal_test";
  } catch {
    return false;
  }
}

function fixtureAdapter(id: string, items: RawCandidate[]): SourceAdapter {
  return { id, fetch: async () => items };
}

const describeDb = isPortalTestDatabase() ? describe : describe.skip;

describeDb("runIngest (portal_test)", () => {
  it("upserts candidates idempotently and records every audit result", async () => {
    const source = `test-ingest-${randomUUID()}`;
    try {
      const first = await runIngest(
        fixtureAdapter(source, [
          { externalRef: "a1", sourceUrl: "https://example.test/a1", raw: { model: "X1" } },
          { externalRef: "", raw: { model: "invalid" } },
        ]),
      );
      const unchanged = await runIngest(fixtureAdapter(source, [{ externalRef: "a1", sourceUrl: "https://example.test/a1", raw: { model: "X1" } }]));
      const changed = await runIngest(fixtureAdapter(source, [{ externalRef: "a1", sourceUrl: "https://example.test/a1", raw: { model: "X1", year: 2026 } }]));

      expect(first).toEqual({ found: 2, changed: 1, rejected: 1 });
      expect(unchanged).toEqual({ found: 1, changed: 0, rejected: 0 });
      expect(changed).toEqual({ found: 1, changed: 1, rejected: 0 });

      const candidates = await pool.query<{ external_ref: string; raw: { year?: number }; status: string }>(
        `select external_ref, raw, status from machine_candidates where source = $1`,
        [source],
      );
      expect(candidates.rows).toEqual([{ external_ref: "a1", raw: { model: "X1", year: 2026 }, status: "pending" }]);

      const runs = await pool.query<{ found: number; changed: number; rejected: number; error: string | null }>(
        `select found, changed, rejected, error from ingest_runs where source = $1 order by started_at, created_at`,
        [source],
      );
      expect(runs.rows).toEqual([
        { found: 2, changed: 1, rejected: 1, error: null },
        { found: 1, changed: 0, rejected: 0, error: null },
        { found: 1, changed: 1, rejected: 0, error: null },
      ]);
    } finally {
      await pool.query(`delete from machine_candidates where source = $1`, [source]);
      await pool.query(`delete from ingest_runs where source = $1`, [source]);
    }
  });

  it("records the source error before propagating it", async () => {
    const source = `test-ingest-error-${randomUUID()}`;
    const adapter: SourceAdapter = {
      id: source,
      fetch: async () => {
        throw new Error("fixture upstream unavailable");
      },
    };
    try {
      await expect(runIngest(adapter)).rejects.toThrow("fixture upstream unavailable");
      const runs = await pool.query<{ found: number; changed: number; rejected: number; error: string | null }>(
        `select found, changed, rejected, error from ingest_runs where source = $1`,
        [source],
      );
      expect(runs.rows).toEqual([{ found: 0, changed: 0, rejected: 0, error: "fixture upstream unavailable" }]);
    } finally {
      await pool.query(`delete from ingest_runs where source = $1`, [source]);
    }
  });
});
