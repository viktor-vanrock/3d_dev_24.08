import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCommandToken } from "./commandToken.ts";

const payload = { typ: "command", gateway_id: "gateway", command_id: "command", owner_id: "owner", device_id: "device", role: "owner", command: "pause" };

async function signed(kid: string, overrides: Record<string, unknown> = {}) {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const publicJwk = await exportJWK(pair.publicKey);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ ...payload, ...overrides }).setProtectedHeader({ alg: "EdDSA", kid }).setIssuer("portal-api").setAudience("portal-device-agent").setJti("nonce").setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 60).sign(pair.privateKey);
  return { token, key: { kid, alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: publicJwk.x } };
}

function configure(keys: readonly object[]) {
  process.env.COMMAND_VERIFICATION_KEYS = JSON.stringify({ version: "device-agent-runtime.v1", issuer: "portal-api", audience: "portal-device-agent", keys });
}

describe("command token verifier trust boundary", () => {
  afterEach(() => delete process.env.COMMAND_VERIFICATION_KEYS);

  it("supports bounded overlap and rejects a retired key", async () => {
    const current = await signed("current");
    const next = await signed("next");
    configure([current.key, next.key]);
    await expect(verifyCommandToken(current.token, "device", "pause", "command", "gateway")).resolves.not.toBeNull();
    await expect(verifyCommandToken(next.token, "device", "pause", "command", "gateway")).resolves.not.toBeNull();
    configure([next.key]);
    await expect(verifyCommandToken(current.token, "device", "pause", "command", "gateway")).resolves.toBeNull();
  });

  it("rejects cross-device and unknown kid before domain execution", async () => {
    const trusted = await signed("trusted");
    configure([trusted.key]);
    await expect(verifyCommandToken(trusted.token, "other-device", "pause", "command", "gateway")).resolves.toBeNull();
    await expect(verifyCommandToken(trusted.token, "device", "pause", "command", "other-gateway")).resolves.toBeNull();
    const unknown = await signed("unknown");
    await expect(verifyCommandToken(unknown.token, "device", "pause", "command", "gateway")).resolves.toBeNull();
  });

  it("rejects HS256 downgrade even when legacy material is present", async () => {
    const trusted = await signed("trusted");
    configure([trusted.key]);
    process.env.COMMAND_TOKEN_SECRET = "legacy-secret";
    const now = Math.floor(Date.now() / 1000);
    const downgraded = await new SignJWT(payload).setProtectedHeader({ alg: "HS256", kid: "trusted" }).setIssuer("portal-api").setAudience("portal-device-agent").setJti("nonce").setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 60).sign(new TextEncoder().encode("legacy-secret"));
    await expect(verifyCommandToken(downgraded, "device", "pause", "command", "gateway")).resolves.toBeNull();
    delete process.env.COMMAND_TOKEN_SECRET;
  });
});
