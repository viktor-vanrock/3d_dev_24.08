import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePrusaIniViaMesh } from "./mesh-slicer-profile.adapter.ts";

afterEach(() => vi.unstubAllGlobals());

describe("resolvePrusaIniViaMesh", () => {
  it("returns the resolved ini text and params on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ profile_id: "p1", ini: "[print]\nwall_loops = 2\n", params: { wall_loops: 2 } }), { status: 200 })),
    );
    await expect(resolvePrusaIniViaMesh("p1")).resolves.toEqual({ ok: true, ini: "[print]\nwall_loops = 2\n", params: { wall_loops: 2 } });
  });
  it("surfaces mesh's structured unsupported_slicer error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: { error: "unsupported_slicer" } }), { status: 422 })),
    );
    await expect(resolvePrusaIniViaMesh("p1")).resolves.toEqual({ ok: false, status: 422, error: "unsupported_slicer" });
  });
  it("reports mesh_unreachable when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect refused");
      }),
    );
    await expect(resolvePrusaIniViaMesh("p1")).resolves.toEqual({ ok: false, status: 503, error: "mesh_unreachable" });
  });
});
