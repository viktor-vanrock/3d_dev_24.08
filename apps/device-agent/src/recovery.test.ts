import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandTrustStatus, commandsAllowed, validateAgentHome } from "./recovery.ts";

describe("agent recovery gates", () => {
  it("blocks missing or corrupt credential material", () => {
    const home = mkdtempSync(join(tmpdir(), "agent-"));
    expect(validateAgentHome(home).ok).toBe(false);
    writeFileSync(join(home, "agent.key"), "");
    writeFileSync(join(home, "credentials.enc"), "not-valid");
    expect(validateAgentHome(home).ok).toBe(false);
  });
  it("does not gate local printing when relay is degraded", () => {
    expect(commandsAllowed("degraded")).toBe(true);
    expect(commandsAllowed("blocked_config")).toBe(false);
    expect(commandsAllowed("revoked")).toBe(false);
  });
  it("blocks remote commands without valid public keys and never treats a legacy secret as fallback", () => {
    expect(commandTrustStatus({ COMMAND_TOKEN_SECRET: "legacy" })).toEqual({ status: "blocked_config", reason: "command_verification_keys_invalid_or_missing" });
    expect(commandTrustStatus({ COMMAND_VERIFICATION_KEYS: JSON.stringify({ version: "device-agent-runtime.v1", issuer: "portal-api", audience: "portal-device-agent", keys: [{ kid: "k", alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: "AQID" }] }) })).toEqual({ status: "ready" });
  });
});
