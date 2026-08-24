import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConnectorVendor } from "./connector.ts";

// Персист токенов, полученных через OperatorConfirmGate — коннектор обязан переиспользовать
// живой токен и НЕ дёргать оператора повторно (connector/common/README.md § «Auth-флоу»).
// Файл живёт рядом с credentials.enc (тот же MULTICA_AGENT_HOME), но отдельно: это
// вендор-токены подключения к железу, не агентский relay-credential.

export interface ConnectorTokenStore {
  load(vendor: ConnectorVendor, host: string): string | undefined;
  save(vendor: ConnectorVendor, host: string, token: string): void;
}

function configDir(): string {
  return process.env.MULTICA_AGENT_HOME ?? join(homedir(), ".3mf-agent");
}

function storePath(): string {
  return join(configDir(), "connector-tokens.json");
}

function key(vendor: ConnectorVendor, host: string): string {
  return `${vendor}:${host}`;
}

function readAll(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch {
    // повреждённый файл — считаем пустым, следующий save перезапишет корректным содержимым.
  }
  return {};
}

export class FileConnectorTokenStore implements ConnectorTokenStore {
  load(vendor: ConnectorVendor, host: string): string | undefined {
    return readAll(storePath())[key(vendor, host)];
  }

  save(vendor: ConnectorVendor, host: string, token: string): void {
    const path = storePath();
    const all = readAll(path);
    all[key(vendor, host)] = token;
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(path, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
}
