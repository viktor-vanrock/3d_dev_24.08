export const PRINT_REQUEST_STATUSES = ["new", "discussion", "in_work", "done", "rejected"] as const;

export type PrintRequestStatus = (typeof PRINT_REQUEST_STATUSES)[number];

export const PRINT_REQUEST_TRANSITIONS: Readonly<Record<PrintRequestStatus, readonly PrintRequestStatus[]>> = {
  new: ["discussion", "rejected"],
  discussion: ["in_work", "rejected"],
  in_work: ["done"],
  done: [],
  rejected: [],
};

export function isPrintRequestStatus(value: unknown): value is PrintRequestStatus {
  return typeof value === "string" && (PRINT_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isValidPrintRequestTransition(from: PrintRequestStatus, to: PrintRequestStatus): boolean {
  return PRINT_REQUEST_TRANSITIONS[from].includes(to);
}
