import { describe, expect, it } from "vitest";
import { Sovol3dStoreAdapter } from "./sovol3d-store.ts";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
}

describe("Sovol3dStoreAdapter", () => {
  it("keeps only 3D Printers products and extracts specs from the body_html bullet template", async () => {
    const products = {
      products: [
        {
          id: 1,
          title: "Sovol SV08 3D Printer",
          handle: "sovol-sv08-3d-printer",
          vendor: "SOVOL",
          product_type: "3D Printers",
          body_html: "<ul><li>CoreXY Kinematics</li><li>Nozzle Temperature: ≤300℃ (572℉)</li><li>Build Volume: 350*350*345mm³</li></ul>",
          images: [{ src: "https://cdn.example/1.jpg" }],
          variants: [{ price: "699.00" }, { price: "799.00" }],
        },
        {
          id: 2,
          title: "Sovol USED 3D Printer",
          handle: "sovol-used-3d-printer",
          vendor: "SOVOL",
          product_type: "3D Printers",
          body_html: "<p>various refurbished models, no fixed spec</p>",
          images: [],
          variants: [{ price: "199.00" }],
        },
        {
          id: 3,
          title: "Sovol PLA Filament",
          handle: "sovol-pla",
          vendor: "SOVOL",
          product_type: "Filament",
          body_html: "<p>1kg spool</p>",
          images: [],
          variants: [{ price: "19.99" }],
        },
      ],
    };
    const fetchImpl = (async () => jsonResponse(products)) as typeof fetch;

    const adapter = new Sovol3dStoreAdapter({ fetchImpl });
    const items = await adapter.fetch();

    expect(items).toEqual([
      {
        externalRef: "1",
        sourceUrl: "https://www.sovol3d.com/products/sovol-sv08-3d-printer",
        raw: {
          vendor: "SOVOL",
          model: "Sovol SV08 3D Printer",
          specs: {
            kinematics: "corexy",
            max_nozzle_temp_c: 300,
            build_volume: { x: 350, y: 350, z: 345, shape: "rectangular" },
          },
          images: ["https://cdn.example/1.jpg"],
          price: { amount: 699, currency: "USD" },
        },
      },
    ]);
  });

  it("parses the various build-volume punctuation seen across product listings", async () => {
    const cases: Array<[string, { x: number; y: number; z: number }]> = [
      ["Build Volume: 500×500×500 mm³ (500*500*450 mm³ with enclosure kit)", { x: 500, y: 500, z: 500 }],
      ["Build volume: 300*300*350mm³", { x: 300, y: 300, z: 350 }],
      ["Print Size: 220×220×250mm", { x: 220, y: 220, z: 250 }],
      ["Large Print Size: 500mm×500mm×500mm", { x: 500, y: 500, z: 500 }],
    ];

    for (const [bullet, expected] of cases) {
      const products = {
        products: [
          {
            id: 42,
            title: "Case Printer",
            handle: "case-printer",
            vendor: "SOVOL",
            product_type: "3D Printers",
            body_html: `<ul><li>${bullet}</li></ul>`,
            images: [],
            variants: [],
          },
        ],
      };
      const fetchImpl = (async () => jsonResponse(products)) as typeof fetch;
      const adapter = new Sovol3dStoreAdapter({ fetchImpl });
      const [item] = await adapter.fetch();
      expect(item?.raw).toMatchObject({ specs: { build_volume: { ...expected, shape: "rectangular" } } });
    }
  });

  it("retries a transient network failure without exceeding the configured attempts", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary network failure");
      return jsonResponse({ products: [] });
    }) as typeof fetch;
    const adapter = new Sovol3dStoreAdapter({ fetchImpl, timeoutMs: 25, retries: 1, retryDelayMs: 0 });

    await expect(adapter.fetch()).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it("reports the bounded failure after retries are exhausted", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const adapter = new Sovol3dStoreAdapter({ fetchImpl, timeoutMs: 25, retries: 1, retryDelayMs: 0 });

    await expect(adapter.fetch()).rejects.toThrow("Request failed after 2 attempt(s)");
  });
});
