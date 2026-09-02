import { isValidUsername } from "../../modules/profile/domain/profile.ts";

export const DEFAULT_NEST_PORT = 3002;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
export const MIN_DEVELOPMENT_ADMIN_PASSWORD_LENGTH = 8;

export interface AdminBootstrapConfig {
  readonly username: string;
  readonly password: string;
  readonly updatePasswordOnStartup: boolean;
}

// Источник правды по разрешённым CORS-origin (MF-636): CORS_ALLOWED_ORIGINS, иначе WEB_APP_URL,
// иначе прод-домен. Использует Nest bootstrap для production-allowlist (в dev CORS открыт).
const PROD_DEFAULT_ORIGIN = "https://3mf.tech";

export function getAllowedOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? process.env.WEB_APP_URL ?? PROD_DEFAULT_ORIGIN)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveNestPort(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_NEST_PORT;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseBoolean(name: string, value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}

export function resolveAdminBootstrapConfig(environment: Record<string, unknown>): AdminBootstrapConfig | null {
  const usernameValue = environment.ADMIN_USERNAME;
  const passwordValue = environment.ADMIN_PASSWORD;
  const username = typeof usernameValue === "string" ? usernameValue : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const updatePasswordOnStartup = parseBoolean("ADMIN_PASSWORD_UPDATE_ON_STARTUP", environment.ADMIN_PASSWORD_UPDATE_ON_STARTUP, false);

  // Чтение конфигурации bootstrap-владельца, не проверка доступа
  // eslint-disable-next-line no-restricted-syntax
  if (username === "" && password === "") {
    if (updatePasswordOnStartup) {
      throw new Error("ADMIN_PASSWORD_UPDATE_ON_STARTUP requires ADMIN_USERNAME and ADMIN_PASSWORD");
    }
    return null;
  }
  // Чтение конфигурации bootstrap-владельца, не проверка доступа
  // eslint-disable-next-line no-restricted-syntax
  if (username === "" || password === "") {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be configured together");
  }
  if (username !== username.trim().toLowerCase() || username.length < 3 || !isValidUsername(username)) {
    throw new Error("ADMIN_USERNAME must be a lowercase username containing 3-32 letters, digits, or dots");
  }
  const minPasswordLength = environment.NODE_ENV === "development" ? MIN_DEVELOPMENT_ADMIN_PASSWORD_LENGTH : MIN_ADMIN_PASSWORD_LENGTH;
  if (password.length < minPasswordLength) {
    throw new Error(`ADMIN_PASSWORD must contain at least ${minPasswordLength} characters`);
  }
  if (password.length > 1024) throw new Error("ADMIN_PASSWORD must contain at most 1024 characters");

  return { username, password, updatePasswordOnStartup };
}

export function validateRuntimeEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
  const rawPort = environment.PORT;
  if (rawPort !== undefined && typeof rawPort !== "string") {
    throw new Error("PORT must be provided as a string environment variable");
  }

  const admin = resolveAdminBootstrapConfig(environment);
  const relayControlBaseUrl = environment.RELAY_INTERNAL_BASE_URL;
  if (environment.NODE_ENV === "production" && (typeof relayControlBaseUrl !== "string" || relayControlBaseUrl.trim() === "")) {
    throw new Error("RELAY_INTERNAL_BASE_URL is required in production");
  }
  if (typeof relayControlBaseUrl === "string" && relayControlBaseUrl.trim() !== "") {
    let parsed: URL;
    try {
      parsed = new URL(relayControlBaseUrl);
    } catch {
      throw new Error("RELAY_INTERNAL_BASE_URL must be an absolute HTTP(S) URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("RELAY_INTERNAL_BASE_URL must use HTTP or HTTPS");
  }
  return {
    ...environment,
    PORT: resolveNestPort(rawPort),
    ...(admin === null
      ? {}
      : {
          ADMIN_USERNAME: admin.username,
          ADMIN_PASSWORD_UPDATE_ON_STARTUP: admin.updatePasswordOnStartup,
        }),
  };
}
