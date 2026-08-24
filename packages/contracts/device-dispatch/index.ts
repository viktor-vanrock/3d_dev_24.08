export type DispatchRejectionCode =
  | "ACCOUNT_MISMATCH"
  | "PROFILE_MISMATCH"
  | "CONFIG_MISMATCH"
  | "CAPABILITY_MISMATCH"
  | "TARGET_OFFLINE"
  | "CANCELLED";

export interface DispatchTarget {
  accountId: string;
  profileHash: string;
  configFingerprint: string;
  nozzleFingerprint: string;
  online: boolean;
  cancelled: boolean;
}

export interface DispatchCandidate {
  accountId: string;
  sliceJobId: string;
  profileHash: string;
  configFingerprint: string;
  nozzleFingerprint: string;
  target: DispatchTarget;
}

export type DispatchValidation =
  | { ok: true; sliceJobId: string }
  | { ok: false; code: DispatchRejectionCode; sliceJobId: string };

export * from "./trust-policy.js";
/** Pure, ordered safety gate. A rejected result must never be handed to a device. */
export function validateDispatch(candidate: DispatchCandidate): DispatchValidation {
  const { target } = candidate;
  if (candidate.accountId !== target.accountId) return reject(candidate, "ACCOUNT_MISMATCH");
  if (candidate.profileHash !== target.profileHash) return reject(candidate, "PROFILE_MISMATCH");
  if (candidate.configFingerprint !== target.configFingerprint) return reject(candidate, "CONFIG_MISMATCH");
  if (candidate.nozzleFingerprint !== target.nozzleFingerprint) return reject(candidate, "CAPABILITY_MISMATCH");
  if (!target.online) return reject(candidate, "TARGET_OFFLINE");
  if (target.cancelled) return reject(candidate, "CANCELLED");
  return { ok: true, sliceJobId: candidate.sliceJobId };
}
function reject(candidate: DispatchCandidate, code: DispatchRejectionCode): DispatchValidation {
  return { ok: false, code, sliceJobId: candidate.sliceJobId };
}
