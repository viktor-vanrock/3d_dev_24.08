export const PRODUCTION_CONNECTOR_TYPES = ["moonraker"] as const;

export type ProductionConnectorType = (typeof PRODUCTION_CONNECTOR_TYPES)[number];

export interface MoonrakerConnectorConfig {
  readonly type: "moonraker";
  readonly httpUrl: string;
  readonly apiKey?: string;
}

export type ConnectorConfig = MoonrakerConnectorConfig;

export class ConnectorConfigError extends Error {
  constructor(message: string) {
    super(`invalid connector config: ${message}`);
    this.name = "ConnectorConfigError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) throw new ConnectorConfigError(`unknown field ${unknownKey}`);
}

function validateMoonrakerUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new ConnectorConfigError("httpUrl must be a non-empty string");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorConfigError("httpUrl must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ConnectorConfigError("httpUrl must use http or https");
  if (url.username !== "" || url.password !== "") throw new ConnectorConfigError("httpUrl must not contain credentials");
  return value.replace(/\/$/, "");
}

export function validateConnectorConfig(value: unknown): ConnectorConfig {
  if (!isRecord(value)) throw new ConnectorConfigError("expected an object");
  if (value.type !== "moonraker") throw new ConnectorConfigError("unsupported type");

  assertKnownKeys(value, new Set(["type", "httpUrl", "apiKey"]));
  const httpUrl = validateMoonrakerUrl(value.httpUrl);
  if (value.apiKey !== undefined && (typeof value.apiKey !== "string" || value.apiKey.length === 0)) {
    throw new ConnectorConfigError("apiKey must be a non-empty string when provided");
  }

  return {
    type: "moonraker",
    httpUrl,
    ...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
  };
}

export function parseConnectorConfig(raw: string): ConnectorConfig {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConnectorConfigError("expected valid JSON");
  }
  return validateConnectorConfig(value);
}

