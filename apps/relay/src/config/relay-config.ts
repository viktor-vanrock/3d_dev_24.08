import { randomUUID } from "node:crypto";

export const RELAY_CONFIG = Symbol("RELAY_CONFIG");

export interface RelayConfig {
  readonly protocolVersion: "v1";
  readonly instanceId: string;
  readonly api: {
    readonly baseUrl: string;
    readonly serviceToken: string;
    readonly timeoutMs: number;
    readonly retryAttempts: number;
    readonly retryBaseDelayMs: number;
  };
  readonly gateway: {
    readonly host: string;
    readonly port: number;
    readonly maxFrameBytes: number;
    readonly maxSessions: number;
    readonly maxInflightFrames: number;
    readonly maxInflightFramesPerSession: number;
    readonly maxFramesPerSecond: number;
    readonly maxBufferedBytes: number;
    readonly maxBufferedBytesPerSession: number;
    readonly helloTimeoutMs: number;
    readonly heartbeatSweepMs: number;
    readonly revalidationIntervalMs: number;
    readonly revalidationTimeoutMs: number;
    readonly revalidationFailClosedMs: number;
    readonly shutdownDrainMs: number;
    readonly tls: {
      readonly certificateFile: string;
      readonly privateKeyFile: string;
      readonly clientCaFile: string;
    };
  };
  readonly observability: {
    readonly host: string;
    readonly port: number;
  };
}

type Environment = Readonly<Record<string, string | undefined>>;

const INTEGER_PATTERN = /^\d+$/;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required relay configuration: ${name}`);
  return value;
}

function boundedInteger(environment: Environment, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  if (!INTEGER_PATTERN.test(raw)) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function validHost(environment: Environment, name: string, fallback: string): string {
  const value = environment[name]?.trim() || fallback;
  if (value.length > 255 || /[\s/]/.test(value)) throw new Error(`${name} must be a valid bind host`);
  return value;
}

function apiBaseUrl(environment: Environment): string {
  const raw = required(environment, "RELAY_API_BASE_URL");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("RELAY_API_BASE_URL must be an absolute HTTP(S) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("RELAY_API_BASE_URL must use HTTP or HTTPS");
  }
  if (environment.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("RELAY_API_BASE_URL must use HTTPS in production");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

export function loadRelayConfig(environment: Environment = process.env): RelayConfig {
  for (const legacyName of ["RELAY_INTERNAL_TOKEN", "RELAY_API_TOKEN"] as const) {
    if (environment[legacyName]?.trim()) {
      throw new Error(`${legacyName} is obsolete; configure RELAY_SERVICE_TOKEN only`);
    }
  }

  const protocolVersion = environment.RELAY_PROTOCOL_VERSION?.trim() || "v1";
  if (protocolVersion !== "v1") throw new Error("RELAY_PROTOCOL_VERSION must be exactly v1");

  const serviceToken = required(environment, "RELAY_SERVICE_TOKEN");
  if (serviceToken.length < 32 || serviceToken.length > 512) {
    throw new Error("RELAY_SERVICE_TOKEN must contain between 32 and 512 characters");
  }

  const instanceId = environment.RELAY_INSTANCE_ID?.trim() || `relay-${randomUUID()}`;
  if (!INSTANCE_ID_PATTERN.test(instanceId)) throw new Error("RELAY_INSTANCE_ID contains unsupported characters");

  const gatewayPort = boundedInteger(environment, "RELAY_GATEWAY_PORT", 8443, 1, 65_535);
  const observabilityPort = boundedInteger(environment, "RELAY_OBSERVABILITY_PORT", 9091, 1, 65_535);
  const gatewayHost = validHost(environment, "RELAY_GATEWAY_HOST", "0.0.0.0");
  const observabilityHost = validHost(environment, "RELAY_OBSERVABILITY_HOST", "127.0.0.1");
  if (gatewayPort === observabilityPort && gatewayHost === observabilityHost) {
    throw new Error("Gateway WSS and observability listeners must use different addresses");
  }

  return {
    protocolVersion: "v1",
    instanceId,
    api: {
      baseUrl: apiBaseUrl(environment),
      serviceToken,
      timeoutMs: boundedInteger(environment, "RELAY_API_TIMEOUT_MS", 1_000, 50, 10_000),
      retryAttempts: boundedInteger(environment, "RELAY_API_RETRY_ATTEMPTS", 2, 0, 5),
      retryBaseDelayMs: boundedInteger(environment, "RELAY_API_RETRY_BASE_DELAY_MS", 50, 1, 1_000),
    },
    gateway: {
      host: gatewayHost,
      port: gatewayPort,
      maxFrameBytes: boundedInteger(environment, "RELAY_MAX_FRAME_BYTES", 131_072, 1_024, 131_072),
      maxSessions: boundedInteger(environment, "RELAY_MAX_SESSIONS", 10_000, 1, 100_000),
      maxInflightFrames: boundedInteger(environment, "RELAY_MAX_INFLIGHT_FRAMES", 1_024, 1, 100_000),
      maxInflightFramesPerSession: boundedInteger(environment, "RELAY_MAX_INFLIGHT_FRAMES_PER_SESSION", 4, 1, 64),
      maxFramesPerSecond: boundedInteger(environment, "RELAY_MAX_FRAMES_PER_SECOND", 60, 1, 10_000),
      maxBufferedBytes: boundedInteger(environment, "RELAY_MAX_BUFFERED_BYTES", 67_108_864, 65_536, 1_073_741_824),
      maxBufferedBytesPerSession: boundedInteger(environment, "RELAY_MAX_BUFFERED_BYTES_PER_SESSION", 1_048_576, 16_384, 67_108_864),
      helloTimeoutMs: boundedInteger(environment, "RELAY_HELLO_TIMEOUT_MS", 10_000, 100, 60_000),
      heartbeatSweepMs: boundedInteger(environment, "RELAY_HEARTBEAT_SWEEP_MS", 1_000, 100, 10_000),
      revalidationIntervalMs: boundedInteger(environment, "RELAY_REVALIDATION_INTERVAL_MS", 2_000, 100, 2_000),
      revalidationTimeoutMs: boundedInteger(environment, "RELAY_REVALIDATION_TIMEOUT_MS", 1_000, 50, 1_000),
      revalidationFailClosedMs: boundedInteger(environment, "RELAY_REVALIDATION_FAIL_CLOSED_MS", 5_000, 1_000, 5_000),
      shutdownDrainMs: boundedInteger(environment, "RELAY_SHUTDOWN_DRAIN_MS", 10_000, 100, 60_000),
      tls: {
        certificateFile: required(environment, "RELAY_TLS_CERT_FILE"),
        privateKeyFile: required(environment, "RELAY_TLS_KEY_FILE"),
        clientCaFile: required(environment, "RELAY_TLS_CA_FILE"),
      },
    },
    observability: { host: observabilityHost, port: observabilityPort },
  };
}
