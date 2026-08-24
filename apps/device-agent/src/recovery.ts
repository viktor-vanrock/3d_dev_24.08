import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readCommandVerificationKeySet } from "./commandTrust.ts";

export type AgentHealthStatus = "healthy" | "degraded" | "blocked_config" | "revoked";

/** Configuration is deliberately fail-closed: a bad credential must never reach relay. */
export function validateAgentHome(home: string): { ok: true } | { ok: false; reason: string } {
  const identityFiles = ["agent-identity.json", "gateway-key.pem", "gateway-certificate.pem", "gateway-ca.pem", "command-verification-keys.json"];
  if (identityFiles.every((name) => existsSync(join(home, name)))) return { ok: true };
  for (const name of ["agent.key", "credentials.enc"]) {
    const path = join(home, name);
    if (!existsSync(path)) return { ok: false, reason: `${name} is missing` };
    if (name === "agent.key" && readFileSync(path, "utf8").trim().length === 0) {
      return { ok: false, reason: "agent.key is empty" };
    }
  }
  return { ok: true };
}

export function commandsAllowed(status: AgentHealthStatus): boolean {
  return status === "healthy" || status === "degraded";
}

/** A legacy symmetric secret never makes the remote path ready. */
export function commandTrustStatus(environment: NodeJS.ProcessEnv = process.env): { readonly status: "ready" } | { readonly status: "blocked_config"; readonly reason: string } {
  return readCommandVerificationKeySet(environment) === null
    ? { status: "blocked_config", reason: "command_verification_keys_invalid_or_missing" }
    : { status: "ready" };
}
