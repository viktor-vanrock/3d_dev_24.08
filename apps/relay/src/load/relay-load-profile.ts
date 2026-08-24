import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { GatewaySession, SessionRegistryLimits, SessionSocket } from "../session/session-registry.ts";
import { SessionRegistry } from "../session/session-registry.ts";

export const RELAY_LOAD_PROFILE = {
  sessionCount: 512,
  framesPerSession: 32,
  payloadBytes: 256,
  thresholds: {
    admissionP95Ms: 2,
    heartbeatP95Ms: 1,
    eventLoopP95Ms: 20,
    eventLoopMaxMs: 100,
    rssDeltaBytes: 64 * 1024 * 1024,
    durationMs: 15_000,
  },
} as const;

export interface RelayLoadResult {
  readonly profile: {
    readonly sessions: number;
    readonly admittedFrames: number;
    readonly heartbeats: number;
    readonly payloadBytes: number;
    readonly slowSessions: number;
  };
  readonly latencyMs: {
    readonly admissionP95: number;
    readonly heartbeatP95: number;
  };
  readonly eventLoopDelayMs: {
    readonly p95: number;
    readonly max: number;
  };
  readonly memory: {
    readonly rssDeltaBytes: number;
  };
  readonly backpressure: {
    readonly slowRejected: boolean;
    readonly fastDeliveredWhileSlow: boolean;
    readonly slowRecovered: boolean;
  };
  readonly durationMs: number;
}

class LoadSocket implements SessionSocket {
  readyState = 1;
  bufferedAmount = 0;
  sentCount = 0;

  send(): void {
    this.sentCount += 1;
  }

  close(): void {
    this.readyState = 3;
  }

  terminate(): void {
    this.readyState = 3;
  }
}

const limits: SessionRegistryLimits = {
  maxSessions: RELAY_LOAD_PROFILE.sessionCount,
  maxInflightFrames: 1_024,
  maxInflightFramesPerSession: 4,
  maxFramesPerSecond: RELAY_LOAD_PROFILE.framesPerSession + 1,
  maxBufferedBytes: 8 * 1024 * 1024,
  maxBufferedBytesPerSession: 64 * 1024,
};

function createSession(index: number, socket = new LoadSocket()): GatewaySession {
  const gatewayId = `load-gateway-${index}`;
  const deviceId = `load-device-${index}`;
  return {
    gatewayId,
    gatewayIdentity: gatewayId,
    certificateFingerprintSha256: "a".repeat(64),
    sessionId: `load-session-${index}`,
    sessionGeneration: 1,
    connectionId: `load-connection-${index}`,
    socket,
    authorizationRevision: 1,
    authorizedDevices: new Map([[deviceId, { device_id: deviceId }]]),
    lastHeartbeatAt: 0,
    lastRevalidatedAt: 0,
    heartbeatTimeoutMs: 5_000,
    inflightFrames: 0,
    rateWindowStartedAt: 0,
    rateWindowCount: 0,
    closing: false,
  };
}

function percentile(samples: readonly number[], percentileValue: number): number {
  if (samples.length === 0) return 0;
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil((percentileValue / 100) * ordered.length) - 1);
  return ordered[index] ?? 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function runRelayLoadProfile(): Promise<RelayLoadResult> {
  const startedAt = performance.now();
  const rssBefore = process.memoryUsage().rss;
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
  const registry = new SessionRegistry();
  registry.configure(limits);

  const sessions = Array.from({ length: RELAY_LOAD_PROFILE.sessionCount }, (_, index) => createSession(index));
  for (const current of sessions) registry.install(current);

  const slow = sessions[0];
  const fast = sessions[1];
  if (!slow || !fast) throw new Error("load profile requires at least two sessions");
  const slowSocket = slow.socket as LoadSocket;
  slowSocket.bufferedAmount = limits.maxBufferedBytesPerSession;
  const payload = "x".repeat(RELAY_LOAD_PROFILE.payloadBytes);

  eventLoopDelay.enable();
  await yieldToEventLoop();

  const admissionSamples: number[] = [];
  const heartbeatSamples: number[] = [];
  let admittedFrames = 0;
  let heartbeats = 0;

  for (let frameIndex = 0; frameIndex < RELAY_LOAD_PROFILE.framesPerSession; frameIndex += 1) {
    for (const current of sessions) {
      const admissionStartedAt = performance.now();
      const admission = registry.beginFrame(current, frameIndex);
      admissionSamples.push(performance.now() - admissionStartedAt);
      if (admission !== "accepted") throw new Error(`unexpected frame admission: ${admission}`);
      admittedFrames += 1;
      registry.endFrame(current);

      const heartbeatStartedAt = performance.now();
      if (!registry.heartbeat(current, frameIndex + 1)) throw new Error("current session heartbeat was rejected");
      heartbeatSamples.push(performance.now() - heartbeatStartedAt);
      heartbeats += 1;
    }
    if ((frameIndex + 1) % 4 === 0) await yieldToEventLoop();
  }

  const slowRejected = !registry.send(slow, payload);
  const fastDeliveredWhileSlow = registry.send(fast, payload);
  slowSocket.bufferedAmount = 0;
  const slowRecovered = registry.send(slow, payload);

  await yieldToEventLoop();
  eventLoopDelay.disable();

  const rssDeltaBytes = Math.max(0, process.memoryUsage().rss - rssBefore);
  const durationMs = performance.now() - startedAt;

  return {
    profile: {
      sessions: sessions.length,
      admittedFrames,
      heartbeats,
      payloadBytes: RELAY_LOAD_PROFILE.payloadBytes,
      slowSessions: 1,
    },
    latencyMs: {
      admissionP95: rounded(percentile(admissionSamples, 95)),
      heartbeatP95: rounded(percentile(heartbeatSamples, 95)),
    },
    eventLoopDelayMs: {
      p95: rounded(eventLoopDelay.percentile(95) / 1_000_000),
      max: rounded(eventLoopDelay.max / 1_000_000),
    },
    memory: { rssDeltaBytes },
    backpressure: { slowRejected, fastDeliveredWhileSlow, slowRecovered },
    durationMs: rounded(durationMs),
  };
}
