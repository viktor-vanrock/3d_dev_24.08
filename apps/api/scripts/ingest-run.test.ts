import { describe, expect, it, vi } from "vitest";
import type { IngestRunResult, SourceAdapter } from "../src/modules/catalog/public/operations.ts";
import { runIngestCli, selectAdapters } from "./ingest-run.ts";

function adapter(id: string): SourceAdapter {
  return { id, fetch: async () => [] };
}

describe("ingest-run CLI", () => {
  it("selects one named adapter or all adapters explicitly", () => {
    const adapters = [adapter("cura-definitions"), adapter("sovol3d-store")];
    expect(selectAdapters(["--adapter", "sovol3d-store"], adapters).map(({ id }) => id)).toEqual(["sovol3d-store"]);
    expect(selectAdapters(["--adapter", "all"], adapters)).toEqual(adapters);
    expect(() => selectAdapters(["--adapter", "missing"], adapters)).toThrow("Неизвестный адаптер");
  });

  it("continues after a source failure, reports aggregate results, exits non-zero, and closes the pool", async () => {
    const adapters = [adapter("failed-source"), adapter("working-source")];
    const run = vi.fn(async (source: SourceAdapter): Promise<IngestRunResult> => {
      if (source.id === "failed-source") throw new Error("upstream unavailable");
      return { found: 3, changed: 2, rejected: 1 };
    });
    const close = vi.fn(async () => undefined);
    const log = vi.fn<(message: string) => void>();
    const error = vi.fn<(message: string, error: unknown) => void>();

    const exitCode = await runIngestCli([], { adapters, run, close, log, error });

    expect(exitCode).toBe(1);
    expect(run.mock.calls.map(([source]) => source.id)).toEqual(["failed-source", "working-source"]);
    expect(error).toHaveBeenCalledWith("  failed: failed-source", expect.objectContaining({ message: "upstream unavailable" }));
    expect(log).toHaveBeenLastCalledWith("summary sources=2 succeeded=1 failed=1 found=3 changed=2 rejected=1");
    expect(close).toHaveBeenCalledOnce();
  });
});
