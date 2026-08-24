export const PAYOUT_METHODS = new Set(["card", "sbp", "account"]);
export const PAYOUT_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending: ["processing", "failed"],
  processing: ["paid", "failed"],
};

export function splitAmount(priceMinor: number) {
  const bps = Number(process.env.BILLING_TAKE_RATE_BPS ?? "2000");
  const platformFeeMinor = Math.round((priceMinor * bps) / 10000);
  return { platformFeeMinor, sellerAmountMinor: priceMinor - platformFeeMinor };
}

export function holdAvailableAt(): Date {
  const days = Number(process.env.BILLING_HOLD_DAYS ?? "14");
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function mapProviderStatus(status: string): "paid" | "cancelled" | null {
  if (status === "succeeded") return "paid";
  if (status === "canceled") return "cancelled";
  return null;
}
