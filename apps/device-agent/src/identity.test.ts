import { describe, expect, it } from "vitest";
import { buildIdentity, configFingerprint } from "./identity.ts";

describe("identity.v1", () => {
  const config = { extruder: { nozzle_diameter: 0.4 }, stepper_x: { position_max: 220 }, secret: "/x" };
  it("is stable and changes when safety configuration changes", () => {
    expect(configFingerprint(config)).toBe(configFingerprint(structuredClone(config)));
    expect(configFingerprint(config)).not.toBe(configFingerprint({ ...config, stepper_x: { position_max: 230 } }));
  });
  it("does not expose raw hardware identifiers", () => {
    const identity = buildIdentity({ deviceId: "device-uuid", agentVersion: "1.0.0", klipperVersion: "v0", model: null, config });
    expect(JSON.stringify(identity)).not.toMatch(/secret|mac|serial|\/x/i);
    expect(identity.schema).toBe("identity.v1");
  });
});
