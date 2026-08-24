/** Версия материала, который подписывается вместе с результатом слайсинга. */
export const FINGERPRINT_CONTRACT_VERSION = "fingerprint-trust.v1" as const;
export const FINGERPRINT_ALGORITHM_VERSION = "sha256-canonical-config.v1" as const;

export type FingerprintSource = "agent" | "declared" | "none";
export type FingerprintState = "agent" | "declared" | "modified" | "revoked" | "stale" | "unknown";
export type FingerprintReuseScope = "account" | "global";

/** Доказательство конфигурации, включаемое в подписанный material. */
export interface FingerprintAttestation {
  contractVersion: typeof FINGERPRINT_CONTRACT_VERSION;
  algorithmVersion: string;
  attestationId: string;
  accountId: string;
  deviceId: string;
  profileId: string;
  sliceKey: string;
  /** Фактический отпечаток экземпляра; для unknown может отсутствовать. */
  configFingerprint: string | null;
  /** Отпечаток канонической stock-модели; custom/modified обязан быть null. */
  canonicalFingerprint: string | null;
  source: FingerprintSource;
  state: FingerprintState;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface FingerprintPolicyTarget {
  reuseScope: FingerprintReuseScope;
  accountId: string;
  deviceId: string;
  profileId: string;
  sliceKey: string;
  configFingerprint: string;
  algorithmVersion: string;
}

export type FingerprintPolicyCode =
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "ALGORITHM_MISMATCH"
  | "ACCOUNT_MISMATCH"
  | "DEVICE_MISMATCH"
  | "PROFILE_MISMATCH"
  | "SLICE_KEY_MISMATCH"
  | "CONFIG_MISMATCH"
  | "EVIDENCE_MISMATCH"
  | "STALE_FINGERPRINT"
  | "REVOKED_FINGERPRINT"
  | "UNKNOWN_FINGERPRINT"
  | "MODIFIED_CONFIG"
  | "GLOBAL_REUSE_FORBIDDEN"
  | "REPLAYED_ATTESTATION"
  | "SIGNATURE_MISMATCH";

export type FingerprintPolicyResult =
  | { ok: true; scope: FingerprintReuseScope; attestationId: string }
  | { ok: false; code: FingerprintPolicyCode; scope: "none" };

export interface FingerprintPolicyOptions {
  now: string | Date;
  seenAttestationIds?: ReadonlySet<string>;
  /** Cryptographic verification belongs to the API/Mesh key owner, not this contract. */
  verifySignature: (material: string, signature: string) => boolean;
}

/** Canonical, signature-covered representation with an explicit cross-runtime field order. */
export function signatureMaterial(attestation: FingerprintAttestation): string {
  return JSON.stringify([
    attestation.contractVersion,
    attestation.algorithmVersion,
    attestation.attestationId,
    attestation.accountId,
    attestation.deviceId,
    attestation.profileId,
    attestation.sliceKey,
    attestation.configFingerprint,
    attestation.canonicalFingerprint,
    attestation.source,
    attestation.state,
    attestation.issuedAt,
    attestation.expiresAt,
  ]);
}

/** Fail-closed policy for cache reuse/dispatch. Rejection never falls back to another scope. */
export function evaluateFingerprintPolicy(
  attestation: FingerprintAttestation,
  target: FingerprintPolicyTarget,
  options: FingerprintPolicyOptions,
): FingerprintPolicyResult {
  if (attestation.contractVersion !== FINGERPRINT_CONTRACT_VERSION) return reject("UNSUPPORTED_CONTRACT_VERSION");
  if (attestation.algorithmVersion !== FINGERPRINT_ALGORITHM_VERSION || target.algorithmVersion !== FINGERPRINT_ALGORITHM_VERSION) {
    return reject("ALGORITHM_MISMATCH");
  }
  if (attestation.accountId !== target.accountId) return reject("ACCOUNT_MISMATCH");
  if (attestation.deviceId !== target.deviceId) return reject("DEVICE_MISMATCH");
  if (attestation.profileId !== target.profileId) return reject("PROFILE_MISMATCH");
  if (attestation.sliceKey !== target.sliceKey) return reject("SLICE_KEY_MISMATCH");
  if (attestation.configFingerprint !== target.configFingerprint) return reject("CONFIG_MISMATCH");
  if (options.seenAttestationIds?.has(attestation.attestationId)) return reject("REPLAYED_ATTESTATION");

  const now = toTime(options.now);
  const issuedAt = toTime(attestation.issuedAt);
  const expiresAt = toTime(attestation.expiresAt);
  if (now === null || issuedAt === null || expiresAt === null || issuedAt > now || expiresAt <= now) {
    return reject("STALE_FINGERPRINT");
  }

  if (attestation.state === "revoked") return reject("REVOKED_FINGERPRINT");
  if (attestation.state === "stale") return reject("STALE_FINGERPRINT");
  if (attestation.state === "unknown") return reject("UNKNOWN_FINGERPRINT");
  if (attestation.state === "modified") {
    if (attestation.source !== "agent" || attestation.canonicalFingerprint !== null) return reject("EVIDENCE_MISMATCH");
    if (!options.verifySignature(signatureMaterial(attestation), attestation.signature)) return reject("SIGNATURE_MISMATCH");
    return target.reuseScope === "account"
      ? { ok: true, scope: "account", attestationId: attestation.attestationId }
      : reject("MODIFIED_CONFIG");
  }

  if (attestation.state === "agent") {
    if (attestation.source !== "agent" || attestation.configFingerprint === null || attestation.canonicalFingerprint !== attestation.configFingerprint) {
      return reject("EVIDENCE_MISMATCH");
    }
  } else if (attestation.state === "declared") {
    if (attestation.source !== "declared" || attestation.configFingerprint === null) return reject("EVIDENCE_MISMATCH");
  } else {
    return reject("UNKNOWN_FINGERPRINT");
  }

  if (!options.verifySignature(signatureMaterial(attestation), attestation.signature)) return reject("SIGNATURE_MISMATCH");
  if (target.reuseScope === "global" && attestation.state !== "agent") return reject("GLOBAL_REUSE_FORBIDDEN");
  return { ok: true, scope: target.reuseScope, attestationId: attestation.attestationId };
}

function reject(code: FingerprintPolicyCode): FingerprintPolicyResult {
  return { ok: false, code, scope: "none" };
}

function toTime(value: string | Date): number | null {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}
