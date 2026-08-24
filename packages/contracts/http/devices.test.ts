import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIRMWARE_PILOT_FRESH_FOR_HOURS, FIRMWARE_PILOT_STAGES, isFirmwarePilotStatus } from "./devices.js";

const fixturePath = fileURLToPath(new URL("./fixtures/firmware-pilot.v1.json", import.meta.url));

type PilotFixture = {
  contract_version: "firmware-pilot.v1";
  endpoint: "GET /printers/:slug";
  fresh_for_hours: number;
  examples: Array<{
    model: { brand: string; name: string; slug: string };
    pilot_status: Record<string, unknown>;
  }>;
  no_data_example: Record<string, unknown>;
};

function fixture(): PilotFixture {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as PilotFixture;
}

describe("firmware pilot HTTP contract", () => {
  it("ships consumer examples for the two exact Fleet pilot models", () => {
    expect(existsSync(fixturePath)).toBe(true);

    const contract = fixture();
    expect(contract.contract_version).toBe("firmware-pilot.v1");
    expect(contract.endpoint).toBe("GET /printers/:slug");
    expect(contract.examples.map(({ model }) => model.slug)).toEqual([
      "creality.ender-3-v3-ke",
      "flsun.v400",
    ]);
  });

  it("validates reported and explicit no-data statuses without transport or control secrets", () => {
    const contract = fixture();
    expect(contract.fresh_for_hours).toBe(FIRMWARE_PILOT_FRESH_FOR_HOURS);
    expect(contract.examples.every(({ pilot_status }) => isFirmwarePilotStatus(pilot_status))).toBe(true);
    expect(isFirmwarePilotStatus(contract.no_data_example)).toBe(true);

    for (const { pilot_status } of contract.examples) {
      expect(pilot_status).toMatchObject({ status: "reported", freshness: "stale", source: "fleet", confidence: "limited" });
      expect(FIRMWARE_PILOT_STAGES).toContain(pilot_status.stage);
      expect(JSON.stringify(pilot_status)).not.toMatch(/lan_endpoint|\bip\b|token|credential|command/i);
    }

    expect(isFirmwarePilotStatus({ status: "reported", stage: "building", updated_at: "2026-07-15T10:00:00Z", freshness: "fresh", source: "fleet", confidence: "limited", lan_endpoint: "192.168.1.1" })).toBe(false);
    expect(isFirmwarePilotStatus({ status: "reported", stage: "ready", updated_at: "2026-07-15T10:00:00Z", freshness: "fresh", source: "operator", confidence: "limited" })).toBe(false);
  });
});
