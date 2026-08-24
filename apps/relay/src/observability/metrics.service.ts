import { Injectable } from "@nestjs/common";

type Labels = Readonly<Record<string, string>>;

function labelsKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  increment(labels: Labels = {}): void {
    const key = labelsKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + 1);
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [labels, value] of [...this.values].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`${this.name}${labels ? `{${labels}}` : ""} ${value}`);
    }
    return lines;
  }
}

class Gauge {
  private value = 0;

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  set(value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${this.name} must be a finite non-negative value`);
    this.value = value;
  }

  increment(): void {
    this.value += 1;
  }

  decrement(): void {
    this.value = Math.max(0, this.value - 1);
  }

  render(): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`, `${this.name} ${this.value}`];
  }
}

@Injectable()
export class RelayMetrics {
  private readonly activeSessions = new Gauge("relay_active_sessions", "Current authenticated gateway sessions.");
  private readonly auth = new Counter("relay_auth_total", "Gateway authorization attempts.");
  private readonly heartbeat = new Counter("relay_heartbeat_total", "Validated gateway heartbeat outcomes.");
  private readonly protocol = new Counter("relay_protocol_frames_total", "Bounded protocol frame outcomes.");
  private readonly backpressure = new Counter("relay_backpressure_total", "Backpressure transitions and rejections.");
  private readonly commandLifecycle = new Counter("relay_command_lifecycle_total", "Command lifecycle transitions observed by relay.");
  private readonly internalApi = new Counter("relay_internal_api_requests_total", "Internal relay API request outcomes.");

  setActiveSessions(value: number): void {
    this.activeSessions.set(value);
  }

  sessionOpened(): void {
    this.activeSessions.increment();
  }

  sessionClosed(): void {
    this.activeSessions.decrement();
  }

  recordAuth(outcome: "authorized" | "denied" | "error"): void {
    this.auth.increment({ outcome });
  }

  recordHeartbeat(outcome: "accepted" | "invalid" | "timeout"): void {
    this.heartbeat.increment({ outcome });
  }

  recordProtocol(direction: "gateway_to_relay" | "relay_to_gateway", outcome: "accepted" | "rejected", frameType: string): void {
    this.protocol.increment({ direction, frame_type: frameType.slice(0, 64), outcome });
  }

  recordBackpressure(scope: "session" | "global", outcome: "paused" | "resumed" | "rejected"): void {
    this.backpressure.increment({ outcome, scope });
  }

  recordCommand(state: "claimed" | "delivered" | "acknowledged" | "executed" | "failed" | "expired", outcome: "accepted" | "replayed" | "rejected"): void {
    this.commandLifecycle.increment({ outcome, state });
  }

  recordInternalApi(operation: string, outcome: "success" | "retry" | "timeout" | "error"): void {
    this.internalApi.increment({ operation: operation.slice(0, 96), outcome });
  }

  render(): string {
    return [
      ...this.activeSessions.render(),
      ...this.auth.render(),
      ...this.heartbeat.render(),
      ...this.protocol.render(),
      ...this.backpressure.render(),
      ...this.commandLifecycle.render(),
      ...this.internalApi.render(),
    ].join("\n") + "\n";
  }
}
