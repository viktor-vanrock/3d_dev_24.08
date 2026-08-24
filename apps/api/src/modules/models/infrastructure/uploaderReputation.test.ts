import { describe, expect, it } from "vitest";
import { computeTrustedUploaderBadge, UPLOADER_REPUTATION_MIN_SAMPLES, UPLOADER_REPUTATION_MIN_SUCCESS_RATIO } from "./uploaderReputation.ts";

describe("computeTrustedUploaderBadge (MF-1066)", () => {
  it("no signal yet — unknown, not trusted", () => {
    expect(computeTrustedUploaderBadge(0, 0)).toEqual({ totalContributions: 0, trustScore: null, trustedUploader: false });
  });

  it("below the minimum sample size never earns the badge, even at 100% success", () => {
    const result = computeTrustedUploaderBadge(UPLOADER_REPUTATION_MIN_SAMPLES - 1, 0);
    expect(result.trustedUploader).toBe(false);
    expect(result.trustScore).toBe(1);
  });

  it("earns the badge once samples and ratio both clear the threshold", () => {
    const result = computeTrustedUploaderBadge(UPLOADER_REPUTATION_MIN_SAMPLES, 0);
    expect(result.totalContributions).toBe(UPLOADER_REPUTATION_MIN_SAMPLES);
    expect(result.trustScore).toBe(1);
    expect(result.trustedUploader).toBe(true);
  });

  it("enough samples but a low success ratio does not earn the badge", () => {
    const total = UPLOADER_REPUTATION_MIN_SAMPLES * 2;
    const successful = Math.floor(total * (UPLOADER_REPUTATION_MIN_SUCCESS_RATIO - 0.1));
    const result = computeTrustedUploaderBadge(successful, total - successful);
    expect(result.trustScore).toBeLessThan(UPLOADER_REPUTATION_MIN_SUCCESS_RATIO);
    expect(result.trustedUploader).toBe(false);
  });

  it("a single failure on a long clean history does not flip the badge off", () => {
    const result = computeTrustedUploaderBadge(49, 1);
    expect(result.trustScore).toBeCloseTo(0.98);
    expect(result.trustedUploader).toBe(true);
  });

  // MF-1788: дебет по принятой жалобе на модель — это ledgerBalance, не мутация
  // successful/failed_contributions (см. описание карточки, ledger — источник истины).
  it("a negative ledger balance (accepted model report) can flip a clean badge off", () => {
    const clean = computeTrustedUploaderBadge(UPLOADER_REPUTATION_MIN_SAMPLES, 0, 0);
    expect(clean.trustedUploader).toBe(true);

    const debited = computeTrustedUploaderBadge(UPLOADER_REPUTATION_MIN_SAMPLES, 0, -3);
    expect(debited.totalContributions).toBe(UPLOADER_REPUTATION_MIN_SAMPLES + 3);
    expect(debited.trustScore).toBeLessThan(clean.trustScore!);
    expect(debited.trustedUploader).toBe(false);
  });

  it("a positive ledger balance (compensating reversal) cancels out a prior debit", () => {
    // Right at the trusted_uploader boundary: MIN_SAMPLES total, exactly MIN_SUCCESS_RATIO —
    // one more failed-equivalent unit (the debit) is enough to push the ratio below threshold.
    const successful = 4;
    const failed = 1;
    const clean = computeTrustedUploaderBadge(successful, failed, 0);
    expect(clean.trustScore).toBe(UPLOADER_REPUTATION_MIN_SUCCESS_RATIO);
    expect(clean.trustedUploader).toBe(true);

    const debited = computeTrustedUploaderBadge(successful, failed, -1);
    expect(debited.trustedUploader).toBe(false);

    const reversed = computeTrustedUploaderBadge(successful, failed, 0);
    expect(reversed.trustedUploader).toBe(true);

    // net-positive ledger balance beyond the original debit doesn't manufacture extra credit —
    // it simply stops adding penalty (clamped at 0), same shape as a clean history.
    const overReversed = computeTrustedUploaderBadge(successful, failed, 5);
    expect(overReversed).toEqual(reversed);
  });
});
