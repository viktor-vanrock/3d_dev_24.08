import type { PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

import { batchRecomputeVisible, recomputePostScore } from "./scores.ts";

function result<Row extends Record<string, unknown>>(rows: Row[]): QueryResult<Row> {
  return { rows, command: "SELECT", rowCount: rows.length, oid: 0, fields: [] };
}

describe("feed score materialization", () => {
  it("recomputes only the visible post ids selected by the bounded batch", async () => {
    const query = vi.fn().mockResolvedValueOnce(result([{ id: "visible-1" }, { id: "visible-2" }]));
    const recompute = vi.fn().mockResolvedValue(undefined);
    const database = { query } as unknown as Pick<PoolClient, "query">;

    await expect(batchRecomputeVisible(database, recompute)).resolves.toBe(2);
    expect(String(query.mock.calls[0]?.[0])).toContain("where status = 'visible'");
    expect(recompute.mock.calls.map(([id]) => id)).toEqual(["visible-1", "visible-2"]);
  });

  it("removes stale materialization when the post is absent or not visible", async () => {
    const query = vi.fn().mockResolvedValueOnce(result([])).mockResolvedValueOnce(result([]));
    const database = { query } as unknown as Pick<PoolClient, "query">;

    await recomputePostScore("hidden-post", database);
    expect(String(query.mock.calls[0]?.[0])).toContain("status = 'visible'");
    expect(String(query.mock.calls[1]?.[0])).toContain("delete from post_score");
  });

  it("materializes hot, best, and controversial scores from weighted votes", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(result([{ votes_up_weighted: "10.000", votes_down_weighted: "2.000", created_at: new Date("2026-01-01T00:00:00Z") }]))
      .mockResolvedValueOnce(result([]));
    const database = { query } as unknown as Pick<PoolClient, "query">;

    await recomputePostScore("visible-post", database);
    const write = query.mock.calls[1];
    expect(String(write?.[0])).toContain("insert into post_score");
    expect(write?.[1]).toEqual(["visible-post", expect.any(Number), expect.any(Number), expect.any(Number)]);
  });
});
