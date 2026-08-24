import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const printersTables: DomainTableManifest = {
  owns: ["community_firmware", "guest_print_nonces", "printer_connections", "printer_reports", "printers", "user_printers"],
  readsForeignViews: [],
};
