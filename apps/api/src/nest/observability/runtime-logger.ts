import { Injectable } from "@nestjs/common";
import pino, { type DestinationStream, type Logger } from "pino";

export const RUNTIME_REDACTION_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-relay-internal-token",
  "req.body",
  "request.body",
  "res.body",
  "response.body",
  "body",
  "authorization",
  "cookie",
  "password",
  "passwordHash",
  "otp",
  "token",
  "sessionToken",
  "apiKey",
  "gatewayPrivateKey",
  "providerSecret",
  "prompt",
  "image",
  "messageBody",
  "searchQuery",
  "payoutRequisites",
  "email",
  "phone",
  "username",
  "fullName",
  "err",
  "error.message",
  "error.stack",
] as const;

export const RUNTIME_LOGGER_OPTIONS: pino.LoggerOptions = {
  base: { service: "api" },
  redact: { paths: [...RUNTIME_REDACTION_PATHS], censor: "[REDACTED]" },
};

export interface SafeLogRecord {
  readonly event: string;
  readonly request_id?: string;
  readonly method?: string;
  // Только path без query-строки: в query приезжают searchQuery/email и прочий PII,
  // который redact по имени поля не поймает внутри склеенного URL.
  readonly path?: string;
  readonly status_code?: number;
  readonly latency_ms?: number;
  readonly error_code?: string;
  readonly provider?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly credentialType?: "session";
  readonly ownerId?: string;
  readonly actorId?: string;
  readonly count?: number;
}

const SAFE_LOG_KEYS = new Set<keyof SafeLogRecord>([
  "event",
  "request_id",
  "method",
  "path",
  "status_code",
  "latency_ms",
  "error_code",
  "provider",
  "outcome",
  "reason",
  "credentialType",
  "ownerId",
  "actorId",
  "count",
]);

export function allowlistedLogRecord(record: SafeLogRecord): SafeLogRecord {
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => SAFE_LOG_KEYS.has(key as keyof SafeLogRecord) && value !== undefined)) as unknown as SafeLogRecord;
}

export function createRuntimeLogger(destination?: DestinationStream): Logger {
  return pino(RUNTIME_LOGGER_OPTIONS, destination);
}

@Injectable()
export class RuntimeLogger {
  private readonly logger: Logger = createRuntimeLogger();

  info(record: SafeLogRecord, message: string): void {
    this.logger.info(allowlistedLogRecord(record), message);
  }

  warn(record: SafeLogRecord, message: string): void {
    this.logger.warn(allowlistedLogRecord(record), message);
  }

  error(record: SafeLogRecord, message: string): void {
    this.logger.error(allowlistedLogRecord(record), message);
  }
}
