import { Inject, Injectable } from "@nestjs/common";
import pino, { type DestinationStream, type Logger } from "pino";
import { RELAY_CONFIG, type RelayConfig } from "../config/relay-config.ts";
import { CorrelationContext } from "./correlation-context.ts";

export const RELAY_LOG_REDACTION_PATHS = [
  "serviceToken",
  "token",
  "authorization",
  "headers.authorization",
  "headers.x-relay-service-token",
  "certificate",
  "privateKey",
  "commandPayload",
  "fileContent",
  "body",
  "err.stack",
] as const;

export interface RelayLogRecord {
  readonly event: string;
  readonly correlation_id?: string;
  readonly gateway_id?: string;
  readonly device_id?: string;
  readonly command_id?: string;
  readonly transfer_id?: string;
  readonly operation?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly status_code?: number;
  readonly attempt?: number;
  readonly latency_ms?: number;
  readonly count?: number;
}

const ALLOWED_KEYS = new Set<keyof RelayLogRecord>([
  "event",
  "correlation_id",
  "gateway_id",
  "device_id",
  "command_id",
  "transfer_id",
  "operation",
  "outcome",
  "reason",
  "status_code",
  "attempt",
  "latency_ms",
  "count",
]);

export function allowlistedRelayLogRecord(record: RelayLogRecord): RelayLogRecord {
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => ALLOWED_KEYS.has(key as keyof RelayLogRecord) && value !== undefined)) as RelayLogRecord;
}

export function createRelayLogger(instanceId: string, destination?: DestinationStream): Logger {
  return pino(
    {
      base: { service: "relay", instance_id: instanceId },
      redact: { paths: [...RELAY_LOG_REDACTION_PATHS], censor: "[REDACTED]" },
    },
    destination,
  );
}

@Injectable()
export class RelayLogger {
  private readonly logger: Logger;

  constructor(
    @Inject(RELAY_CONFIG) config: RelayConfig,
    @Inject(CorrelationContext) private readonly correlation: CorrelationContext,
  ) {
    this.logger = createRelayLogger(config.instanceId);
  }

  info(record: RelayLogRecord, message: string): void {
    this.logger.info(this.withContext(record), message);
  }

  warn(record: RelayLogRecord, message: string): void {
    this.logger.warn(this.withContext(record), message);
  }

  error(record: RelayLogRecord, message: string): void {
    this.logger.error(this.withContext(record), message);
  }

  private withContext(record: RelayLogRecord): RelayLogRecord {
    return allowlistedRelayLogRecord({ correlation_id: this.correlation.currentId, ...record });
  }
}
