export const VENDOR_CLAIM_STATUSES = ["pending", "verified", "revoked"] as const;
export type VendorClaimStatus = (typeof VENDOR_CLAIM_STATUSES)[number];

export const ORGANIZATION_NAME_MAX_LENGTH = 200;
export const EVIDENCE_URL_MAX_LENGTH = 500;
export const EVIDENCE_NOTE_MAX_LENGTH = 2_000;
export const REVIEW_NOTE_MAX_LENGTH = 2_000;

export function isVendorClaimStatus(value: unknown): value is VendorClaimStatus {
  return typeof value === "string" && (VENDOR_CLAIM_STATUSES as readonly string[]).includes(value);
}

export function cleanOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, maxLength);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
