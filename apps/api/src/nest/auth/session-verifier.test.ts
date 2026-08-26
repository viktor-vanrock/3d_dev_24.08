import { ConfigService } from "@nestjs/config";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { SessionVerifier } from "./session-verifier.ts";
import { AccountRestrictedException } from "./account-restricted.exception.ts";

const secret = "session-verifier-metrics-secret";
const userId = "00000000-0000-4000-8000-000000000001";

async function token(sv = 1): Promise<string> {
  return new SignJWT({ username: "tester", sv }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("5m").sign(new TextEncoder().encode(secret));
}

function setup(state: unknown, sanction: unknown = null) {
  const profiles = { loadOwnerAuthState: vi.fn().mockResolvedValue(state) };
  const sanctions = { findActiveForUser: vi.fn().mockResolvedValue(sanction) };
  const logger = { warn: vi.fn() };
  const metrics = { incRevokedCredentialUse: vi.fn() };
  return { metrics, verifier: new SessionVerifier(new ConfigService({ JWT_SECRET: secret }), profiles as never, sanctions as never, logger as never, metrics as never) };
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

  it("rejects an active sanction with its expiration", async () => {
    const endsAt = new Date("2030-01-01T00:00:00.000Z");
    const { verifier } = setup({ status: "active", sessionVersion: 1 }, { endsAt });
    await expect(verifier.readSession({ headers: { authorization: `Bearer ${await token()}` } } as never)).rejects.toBeInstanceOf(AccountRestrictedException);
    await expect(verifier.readSession({ headers: { authorization: `Bearer ${await token()}` } } as never)).rejects.toMatchObject({ endsAt: endsAt.toISOString() });
  });

  it.each(["cancelled", "expired"] as const)("allows a %s sanction history entry", async (_state) => {
    const { verifier } = setup({ status: "active", sessionVersion: 1 });
    await expect(verifier.readSession({ headers: { authorization: `Bearer ${await token()}` } } as never)).resolves.toMatchObject({ id: userId });
  });

  it("prioritizes deleted users over an active sanction", async () => {
    const { verifier } = setup({ status: "deleted", sessionVersion: 1 }, { endsAt: new Date("2030-01-01T00:00:00.000Z") });
    await expect(verifier.readSession({ headers: { authorization: `Bearer ${await token()}` } } as never)).resolves.toBeNull();
  });
});
