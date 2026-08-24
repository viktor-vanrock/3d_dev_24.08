import { afterEach, describe, expect, it, vi } from "vitest";
import firmwarePilotContract from "../../../../../../packages/contracts/http/fixtures/firmware-pilot.v1.json";
import { findPrinterCanon } from "./printercanon.ts";

type FirmwarePilotFixture = {
  examples: Array<{
    model: { brand: string; name: string; slug: string };
    pilot_status: Record<string, unknown>;
  }>;
};

const firmwarePilotFixture = firmwarePilotContract as FirmwarePilotFixture;

afterEach(() => vi.unstubAllGlobals());

describe("findPrinterCanon (firmware-pilot.v1)", () => {
  it.each(firmwarePilotFixture.examples)("читает pilot_status для $model.name по точному slug", async ({ model, pilot_status }) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/printers?")) {
        return { ok: true, json: async () => ({ printers: [{ brand: model.brand, model: model.name, slug: model.slug }] }) };
      }
      if (url === `/printers/${encodeURIComponent(model.slug)}`) {
        return { ok: true, json: async () => ({ printer: { pilot_status } }) };
      }
      throw new Error(`Неожиданный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await findPrinterCanon(model.brand, model.name);

    expect(fetchMock).toHaveBeenNthCalledWith(1, `/printers?q=${encodeURIComponent(model.name)}&limit=5`);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/printers/${encodeURIComponent(model.slug)}`);
    expect(result).toMatchObject({ slug: model.slug, pilotStatus: pilot_status });
  });
});
