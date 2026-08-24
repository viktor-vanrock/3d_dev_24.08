import { decodeProtectedHeader, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { issueCommandToken } from "./command-token.ts";

describe("Ed25519 command token issuer", () => {
  afterEach(() => {
    delete process.env.COMMAND_TOKEN_SIGNING_KID;
    delete process.env.COMMAND_TOKEN_SIGNING_PRIVATE_JWK;
  });

  it("issues bounded tokens with the complete gateway and command claims", async () => {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    process.env.COMMAND_TOKEN_SIGNING_KID = "current";
    process.env.COMMAND_TOKEN_SIGNING_PRIVATE_JWK = JSON.stringify(await exportJWK(pair.privateKey));
    const issued = await issueCommandToken({
      commandId: "33333333-3333-4333-8333-333333333333", gatewayId: "44444444-4444-4444-8444-444444444444",
      ownerId: "11111111-1111-4111-8111-111111111111", actorId: "11111111-1111-4111-8111-111111111111",
      deviceId: "22222222-2222-4222-8222-222222222222", role: "owner", command: "pause", seq: 1,
    });
    expect(decodeProtectedHeader(issued.token)).toMatchObject({ alg: "EdDSA", kid: "current" });
    const { payload } = await jwtVerify(issued.token, pair.publicKey, { algorithms: ["EdDSA"], issuer: "portal-api", audience: "portal-device-agent" });
    expect(payload).toMatchObject({ gateway_id: "44444444-4444-4444-8444-444444444444", command_id: "33333333-3333-4333-8333-333333333333", device_id: "22222222-2222-4222-8222-222222222222" });
    expect(typeof payload.jti).toBe("string");
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(60);
  });

  it("has no legacy symmetric fallback", async () => {
    process.env.COMMAND_TOKEN_SECRET = "legacy";
    await expect(issueCommandToken({ commandId: "c", gatewayId: "g", ownerId: "o", actorId: "a", deviceId: "d", role: "owner", command: "pause", seq: 1 })).rejects.toThrow("command_token_signing_config_missing");
    delete process.env.COMMAND_TOKEN_SECRET;
  });
});
