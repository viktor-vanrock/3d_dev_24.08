import type { DomainTableManifest } from "../../_boundaries/ownership.ts";
export const billingTables: DomainTableManifest = {
  owns: ["ledger_entries", "payment_webhook_events", "payouts", "purchases"],
  readsForeignViews: [],
};
