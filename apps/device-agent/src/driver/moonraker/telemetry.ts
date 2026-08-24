import type { PrinterStatusSnapshot } from "../printerDriver.ts";

/** Additive, versioned device telemetry. Temperatures and percentages use SI/Celsius units. */
export interface TelemetryV1 {
  schema: "telemetry.v1";
  seq: number;
  /** Wall-clock observation time; monotonic ordering is provided by seq. */
  observedAt: string;
  state: PrinterStatusSnapshot["status"];
  progress: number | null;
  nozzle: { currentC: number | null; targetC: number | null };
  bed: { currentC: number | null; targetC: number | null };
  chamber: { currentC: number | null; targetC: number | null };
  fanPercent: number | null;
  sensors: Record<string, number | boolean | string | null>;
  error: string | null;
  job: { id: string | null; fileName: string | null };
}

export interface MoonrakerTelemetryInput {
  snapshot: PrinterStatusSnapshot;
  objects?: Record<string, unknown>;
  observedAtMs?: number;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;

/** Deterministically maps optional/vendor Moonraker objects. Missing data stays null. */
export function mapMoonrakerTelemetry(input: MoonrakerTelemetryInput, seq: number): TelemetryV1 {
  const objects = input.objects ?? input.snapshot.raw;
  const extruder = record(objects.extruder);
  const bed = record(objects.heater_bed);
  const chamber = record(objects.chamber);
  const fan = record(objects.fan);
  const stats = record(objects.print_stats);
  const error = text(stats.message) ?? text(objects.error) ?? (input.snapshot.status === "error" ? "printer_error" : null);
  const fanSpeed = number(fan.speed);
  return {
    schema: "telemetry.v1",
    seq,
    observedAt: new Date(input.observedAtMs ?? Date.now()).toISOString(),
    state: input.snapshot.status,
    progress: input.snapshot.progress,
    nozzle: { currentC: number(extruder.temperature) ?? input.snapshot.nozzleTempC, targetC: number(extruder.target) },
    bed: { currentC: number(bed.temperature) ?? input.snapshot.bedTempC, targetC: number(bed.target) },
    chamber: { currentC: number(chamber.temperature) ?? input.snapshot.chamberTempC, targetC: number(chamber.target) },
    fanPercent: fanSpeed === null ? null : Math.max(0, Math.min(100, fanSpeed * 100)),
    sensors: {
      filamentSensor: typeof objects.filament_switch_sensor === "object" ? text(record(objects.filament_switch_sensor).enabled) : null,
    },
    error,
    job: { id: input.snapshot.jobId, fileName: input.snapshot.jobFileName },
  };
}

/** Coalesces noisy temperature updates while never dropping state/error transitions. */
export class TelemetryCoalescer {
  private seq = 0;
  private pending: TelemetryV1 | null = null;
  private lastEmitted: TelemetryV1 | null = null;
  constructor(private readonly intervalMs = 1000, private readonly now = () => Date.now()) {}
  push(input: MoonrakerTelemetryInput): TelemetryV1 | null {
    const next = mapMoonrakerTelemetry(input, ++this.seq);
    const lastEmitted = this.lastEmitted;
    const transition = lastEmitted === null || next.state !== lastEmitted.state || next.error !== lastEmitted.error;
    if (transition || this.now() - Date.parse(lastEmitted.observedAt) >= this.intervalMs) {
      this.lastEmitted = next; this.pending = null; return next;
    }
    this.pending = next; return null;
  }
  flush(): TelemetryV1 | null { const next = this.pending; if (next) this.lastEmitted = next; this.pending = null; return next; }
}
