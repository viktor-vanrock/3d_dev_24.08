/**
 * Print recovery state machine (docs/epics/v1.device.cloud.md §slice_cache).
 * The command id is deliberately created once per print intent and survives reloads.
 */
export const PRINT_RECOVERY_STORAGE_KEY = "portal.print.recovery.v1";

export type PrintStage = "slice" | "download" | "submit";
export type PrintState = "pending" | "processing" | "ready" | "failed" | "cancelled";
export type PrintFailure = "network-timeout" | "printer-offline" | "rejected" | "duplicate-submit";

export interface PrintRecovery {
  version: 1;
  jobId: string;
  commandId: string;
  stage: PrintStage;
  state: PrintState;
  failure: PrintFailure | null;
  updatedAt: number;
}

export type PrintEvent =
  | { type: "processing"; stage: PrintStage }
  | { type: "ready" }
  | { type: "failed"; failure: PrintFailure }
  | { type: "cancelled" };

const safeStages: ReadonlySet<PrintStage> = new Set(["slice", "download"]);

export function createPrintRecovery(jobId: string, commandId: string, stage: PrintStage = "slice"): PrintRecovery {
  return { version: 1, jobId, commandId, stage, state: "pending", failure: null, updatedAt: Date.now() };
}

export function transitionPrint(state: PrintRecovery, event: PrintEvent): PrintRecovery {
  if (state.state === "cancelled" || state.state === "ready") return state;
  if (event.type === "processing") {
    return { ...state, stage: event.stage, state: "processing", failure: null, updatedAt: Date.now() };
  }
  if (event.type === "ready") return { ...state, state: "ready", failure: null, updatedAt: Date.now() };
  if (event.type === "cancelled") return { ...state, state: "cancelled", failure: null, updatedAt: Date.now() };
  return { ...state, state: "failed", failure: event.failure, updatedAt: Date.now() };
}

/** Retry never re-submits a print command: submit failures must be resolved by the user/device. */
export function canRetryPrint(state: PrintRecovery): boolean {
  return state.state === "failed" && state.failure !== null && safeStages.has(state.stage);
}

export function retryPrint(state: PrintRecovery): PrintRecovery | null {
  return canRetryPrint(state) ? transitionPrint({ ...state, stage: state.stage }, { type: "processing", stage: state.stage }) : null;
}

export function savePrintRecovery(state: PrintRecovery): void {
  try { localStorage.setItem(PRINT_RECOVERY_STORAGE_KEY, JSON.stringify(state)); } catch { /* storage is optional */ }
}

export function loadPrintRecovery(): PrintRecovery | null {
  try {
    const value = JSON.parse(localStorage.getItem(PRINT_RECOVERY_STORAGE_KEY) ?? "null") as Partial<PrintRecovery> | null;
    if (!value || value.version !== 1 || typeof value.jobId !== "string" || typeof value.commandId !== "string") return null;
    if (!["slice", "download", "submit"].includes(value.stage as string) || !["pending", "processing", "ready", "failed", "cancelled"].includes(value.state as string)) return null;
    return { ...value, failure: value.failure ?? null, updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now() } as PrintRecovery;
  } catch { return null; }
}

export function clearPrintRecovery(): void {
  try { localStorage.removeItem(PRINT_RECOVERY_STORAGE_KEY); } catch { /* storage is optional */ }
}
