import { afterEach, describe, expect, it, vi } from "vitest";
import { getGeneration } from "./generations.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generation progress normalization", () => {
  it("сохраняет серверное время ETA, чтобы polling не перезапускал таймер", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            generation: {
              id: "trellis-live",
              branch: "trellis",
              prompt: "Белая печатная модель",
              params: {},
              status: "running",
              preview_url: null,
              artifact_url: null,
              error: null,
              error_code: null,
              created_at: "2026-07-29T00:00:00Z",
              updated_at: "2026-07-29T00:00:05Z",
              progress: {
                phase: "geometry",
                progress: 42,
                eta_seconds: 125,
                estimate_updated_at: "2026-07-29T00:00:04Z",
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const generation = await getGeneration("trellis-live");

    expect(generation).toMatchObject({
      progress: 42,
      phase: "geometry",
      eta_seconds: 125,
      estimate_updated_at: "2026-07-29T00:00:04Z",
    });
  });
});
