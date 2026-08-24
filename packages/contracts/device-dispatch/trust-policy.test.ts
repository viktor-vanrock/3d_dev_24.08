import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_ALGORITHM_VERSION,
  FINGERPRINT_CONTRACT_VERSION,
  type FingerprintAttestation,
  type FingerprintReuseScope,
  evaluateFingerprintPolicy,
  signatureMaterial,
} from "./trust-policy.js";

const now = "2026-07-16T10:00:00.000Z";

function attestation(overrides: Partial<FingerprintAttestation> = {}): FingerprintAttestation {
  return {
    contractVersion: FINGERPRINT_CONTRACT_VERSION,
    algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
    attestationId: "attestation-1",
    accountId: "account-a",
    deviceId: "device-a",
    profileId: "profile-a",
    sliceKey: "slice-a",
    configFingerprint: "fp-a",
    canonicalFingerprint: "fp-a",
    source: "agent",
    state: "agent",
    issuedAt: "2026-07-16T09:00:00.000Z",
    expiresAt: "2026-07-16T11:00:00.000Z",
    signature: "valid",
    ...overrides,
  };
}

function target(scope: FingerprintReuseScope = "account") {
  return {
    reuseScope: scope,
    accountId: "account-a",
    deviceId: "device-a",
    profileId: "profile-a",
    sliceKey: "slice-a",
    configFingerprint: "fp-a",
    algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
  } as const;
}

const options = {
  now,
  verifySignature: (_material: string, signature: string) => signature === "valid",
};

describe("fingerprint trust policy", () => {
  it.each([
    ["agent", { source: "agent", state: "agent" }, "account", true],
    ["agent", { source: "agent", state: "agent" }, "global", true],
    ["declared", { source: "declared", state: "declared" }, "account", true],
    ["declared", { source: "declared", state: "declared" }, "global", false],
    ["modified", { source: "agent", state: "modified", canonicalFingerprint: null, configFingerprint: "custom-fp" }, "account", true],
    ["modified", { source: "agent", state: "modified", canonicalFingerprint: null, configFingerprint: "custom-fp" }, "global", false],
    ["revoked", { source: "agent", state: "revoked" }, "account", false],
    ["stale", { source: "agent", state: "agent", expiresAt: "2026-07-16T09:59:59.000Z" }, "account", false],
    ["unknown", { source: "none", state: "unknown", configFingerprint: null, canonicalFingerprint: null }, "account", false],
  ] as const)("makes %s explicit and does not silently elevate it", (_name, change, scope, allowed) => {
    const expectedTarget = change.state === "modified"
      ? { ...target(scope), configFingerprint: "custom-fp" }
      : target(scope);
    const result = evaluateFingerprintPolicy(attestation(change), expectedTarget, options);
    expect(result.ok).toBe(allowed);
    expect(result.scope).toBe(allowed ? scope : "none");
  });

  it.each([
    ["account", { accountId: "account-b" }, "ACCOUNT_MISMATCH"],
    ["device", { deviceId: "device-b" }, "DEVICE_MISMATCH"],
    ["profile", { profileId: "profile-b" }, "PROFILE_MISMATCH"],
    ["slice key", { sliceKey: "slice-b" }, "SLICE_KEY_MISMATCH"],
    ["fingerprint", { configFingerprint: "fp-b" }, "CONFIG_MISMATCH"],
    ["algorithm", { algorithmVersion: "sha256-canonical-v0" }, "ALGORITHM_MISMATCH"],
  ] as const)("rejects a changed %s before any fallback", (_name, change, code) => {
    const result = evaluateFingerprintPolicy(attestation(change), target(), options);
    expect(result).toMatchObject({ ok: false, code, scope: "none" });
  });

  it("rejects an older contract version instead of treating it as v1", () => {
    const oldContract = attestation({ contractVersion: "fingerprint-trust.v0" as typeof FINGERPRINT_CONTRACT_VERSION });
    expect(evaluateFingerprintPolicy(oldContract, target(), options)).toEqual({
      ok: false,
      code: "UNSUPPORTED_CONTRACT_VERSION",
      scope: "none",
    });
  });

  it("rejects a signature mismatch without falling back to a cache hit", () => {
    const result = evaluateFingerprintPolicy(attestation({ signature: "tampered" }), target(), options);
    expect(result).toEqual({ ok: false, code: "SIGNATURE_MISMATCH", scope: "none" });
  });

  it("covers slice identity and fingerprint fields in the signature material", () => {
    const baseMaterial = signatureMaterial(attestation());
    expect(signatureMaterial(attestation({ sliceKey: "slice-b" }))).not.toBe(baseMaterial);
    expect(signatureMaterial(attestation({ configFingerprint: "fp-b" }))).not.toBe(baseMaterial);
    expect(signatureMaterial(attestation({ profileId: "profile-b" }))).not.toBe(baseMaterial);
  });

  it("rejects a replayed attestation idempotently by requiring a new evidence id", () => {
    const result = evaluateFingerprintPolicy(attestation(), target(), {
      ...options,
      seenAttestationIds: new Set(["attestation-1"]),
    });
    expect(result).toEqual({ ok: false, code: "REPLAYED_ATTESTATION", scope: "none" });
  });

  it("rejects a custom configuration as a canonical/global candidate", () => {
    const custom = attestation({ state: "modified", configFingerprint: "custom-fp", canonicalFingerprint: null });
    expect(evaluateFingerprintPolicy(custom, { ...target("global"), configFingerprint: "custom-fp" }, options)).toEqual({
      ok: false,
      code: "MODIFIED_CONFIG",
      scope: "none",
    });
  });
});
