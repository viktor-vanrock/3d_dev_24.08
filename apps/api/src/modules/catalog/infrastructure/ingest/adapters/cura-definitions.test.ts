import { describe, expect, it } from "vitest";
import { CuraDefinitionsAdapter } from "./cura-definitions.ts";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("CuraDefinitionsAdapter", () => {
  it("keeps only definitions with their own vendor/model and self-contained build volume", async () => {
    const tree = {
      tree: [
        { path: "resources/definitions/good.def.json", type: "blob" },
        { path: "resources/definitions/no_vendor.def.json", type: "blob" },
        { path: "resources/definitions/inherited_only.def.json", type: "blob" },
        { path: "resources/definitions/not_a_definition.txt", type: "blob" },
        { path: "resources/other/ignored.def.json", type: "blob" },
      ],
    };
    const defs: Record<string, unknown> = {
      "resources/definitions/good.def.json": {
        name: "Test Printer X1",
        metadata: { manufacturer: "Test Vendor" },
        overrides: {
          machine_width: { default_value: 220 },
          machine_depth: { default_value: 220 },
          machine_height: { default_value: 250 },
          machine_nozzle_size: { default_value: 0.4 },
        },
      },
      "resources/definitions/no_vendor.def.json": {
        name: "No Vendor Printer",
        overrides: {
          machine_width: { default_value: 200 },
          machine_depth: { default_value: 200 },
          machine_height: { default_value: 200 },
        },
      },
      "resources/definitions/inherited_only.def.json": {
        name: "Inherited Printer",
        metadata: { manufacturer: "Test Vendor" },
        overrides: {},
      },
    };

    let calls = 0;
    const fetchImpl = (async (input: string | URL) => {
      calls += 1;
      const url = String(input);
      if (url.includes("api.github.com")) return jsonResponse(tree);
      const path = url.split("/main/")[1] ?? "";
      const def = defs[path];
      return def ? jsonResponse(def) : jsonResponse({}, false, 404);
    }) as typeof fetch;

    const adapter = new CuraDefinitionsAdapter({ fetchImpl, delayMs: 0 });
    const items = await adapter.fetch();

    expect(items).toEqual([
      {
        externalRef: "resources/definitions/good.def.json",
        sourceUrl: "https://github.com/Ultimaker/Cura/blob/main/resources/definitions/good.def.json",
        raw: {
          vendor: "Test Vendor",
          model: "Test Printer X1",
          specs: {
            build_volume: { x: 220, y: 220, z: 250, shape: "rectangular" },
            nozzle_diameters: [0.4],
          },
        },
      },
    ]);
    // 1 вызов Trees API + 3 файла под resources/definitions/*.def.json (не .txt, не resources/other/*)
    expect(calls).toBe(4);
  });

  it("respects the limit option", async () => {
    const tree = {
      tree: [
        { path: "resources/definitions/a.def.json", type: "blob" },
        { path: "resources/definitions/b.def.json", type: "blob" },
      ],
    };
    let defCalls = 0;
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("api.github.com")) return jsonResponse(tree);
      defCalls += 1;
      return jsonResponse({ name: "X", metadata: { manufacturer: "V" }, overrides: {} });
    }) as typeof fetch;

    const adapter = new CuraDefinitionsAdapter({ fetchImpl, delayMs: 0, limit: 1 });
    await adapter.fetch();

    expect(defCalls).toBe(1);
  });

  it("retries a transient tree failure and applies a timeout signal to every request", async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      if (init?.signal instanceof AbortSignal) signals.push(init.signal);
      if (calls === 1) return jsonResponse({ error: "temporary" }, false, 503);
      return jsonResponse({ tree: [] });
    }) as typeof fetch;

    const adapter = new CuraDefinitionsAdapter({ fetchImpl, delayMs: 0, timeoutMs: 25, retries: 1, retryDelayMs: 0 });

    await expect(adapter.fetch()).resolves.toEqual([]);
    expect(calls).toBe(2);
    expect(signals).toHaveLength(2);
  });
});
