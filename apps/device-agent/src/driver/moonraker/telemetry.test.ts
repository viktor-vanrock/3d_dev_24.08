import { describe, expect, it } from "vitest";
import { TelemetryCoalescer, mapMoonrakerTelemetry } from "./telemetry.ts";
import type { PrinterStatusSnapshot } from "../printerDriver.ts";

const snapshot = (status: PrinterStatusSnapshot["status"]): PrinterStatusSnapshot => ({
  status, nozzleTempC: 210, bedTempC: 60, chamberTempC: null, progress: .42, jobId: "benchy", jobFileName: "benchy.gcode", raw: {},
});

describe("telemetry.v1", () => {
  it.each(["ender3v3ke", "flsun-v400"])('maps %s without guessing absent vendor fields', () => {
    const t = mapMoonrakerTelemetry({ snapshot: snapshot("printing"), objects: { extruder: { temperature: 211, target: 220 }, heater_bed: { temperature: 61, target: 60 }, fan: { speed: .5 } }, observedAtMs: 1000 }, 7);
    expect(t).toMatchObject({ schema: "telemetry.v1", seq: 7, progress: .42, nozzle: { currentC: 211, targetC: 220 }, bed: { targetC: 60 }, fanPercent: 50, chamber: { currentC: null, targetC: null }, error: null });
  });
  it("coalesces rapid temperatures but emits transitions", () => {
    let now = 1000; const c = new TelemetryCoalescer(1000, () => now);
    expect(c.push({ snapshot: snapshot("printing"), observedAtMs: now })).not.toBeNull();
    expect(c.push({ snapshot: snapshot("printing"), observedAtMs: now + 10 })).toBeNull();
    expect(c.push({ snapshot: snapshot("paused"), observedAtMs: now + 20 })).not.toBeNull();
    now += 2000; expect(c.push({ snapshot: snapshot("paused"), observedAtMs: now })).not.toBeNull();
  });
});
