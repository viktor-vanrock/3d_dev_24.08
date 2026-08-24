import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/client.ts", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../../../../db/client.ts";
import { runIngest } from "./run.ts";
import type { SourceAdapter } from "./types.ts";

describe("runIngest audit", () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never);
  });

  it("writes the source error to the audit record and propagates the failure", async () => {
    const adapter: SourceAdapter = {
      id: "failed-source",
      fetch: async () => {
        throw new Error("upstream unavailable");
      },
    };

    await expect(runIngest(adapter)).rejects.toThrow("upstream unavailable");
    expect(pool.query).toHaveBeenCalledOnce();
    expect(vi.mocked(pool.query).mock.calls[0]?.[0]).toContain("insert into ingest_runs");
    expect(vi.mocked(pool.query).mock.calls[0]?.[1]).toEqual(["failed-source", expect.any(Date), 0, 0, 0, "upstream unavailable"]);
  });
});
