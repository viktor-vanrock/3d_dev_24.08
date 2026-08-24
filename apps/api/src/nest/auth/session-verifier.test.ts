import { ConfigService } from "@nestjs/config";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { SessionVerifier } from "./session-verifier.ts";

const secret = "session-verifier-metrics-secret";
const userId = "00000000-0000-4000-8000-000000000001";

async function token(sv = 1): Promise<string> {
  return new SignJWT({ username: "tester", sv }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("5m").sign(new TextEncoder().encode(secret));
}

function setup(state: unknown) {
  const profiles = { loadOwnerAuthState: vi.fn().mockResolvedValue(state) };
  const logger = { warn: vi.fn() };
  const metrics = { incRevokedCredentialUse: vi.fn() };
  return { metrics, verifier: new SessionVerifier(new ConfigService({ JWT_SECRET: secret }), profiles as never, logger as never, metrics as never) };
}

describe("SessionVerifier metrics", () => {
  it("counts a session version mismatch", async () => {
    const { verifier, metrics } = setup({ status: "active", sessionVersion: 2 });
    await expect(verifier.readSession({ headers: { authorization: `Bearer ${await token()}` } } as never)).resolves.toBeNull();
    expect(metrics.incRevokedCredentialUse).toHaveBeenCalledWith("session", "version_mismatch");
  });

  it("counts a session-shaped invalid token", async () => {
    const { verifier, metrics } = setup(null);
    await expect(verifier.readSession({ headers: { authorization: "Bearer bad.jwt.token" } } as never)).resolves.toBeNull();
    expect(metrics.incRevokedCredentialUse).toHaveBeenCalledWith("session", "invalid_token");
  });
});
