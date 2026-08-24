import { beforeEach, describe, expect, it } from "vitest";
import { canRetryPrint, clearPrintRecovery, createPrintRecovery, loadPrintRecovery, PRINT_RECOVERY_STORAGE_KEY, retryPrint, savePrintRecovery, transitionPrint } from "./recovery.ts";

beforeEach(() => localStorage.clear());

describe("print recovery", () => {
  it("keeps one command id and retries only download after timeout", () => {
    const initial = createPrintRecovery("job-1", "cmd-1", "download");
    const failed = transitionPrint(initial, { type: "failed", failure: "network-timeout" });
    const retried = retryPrint(failed)!;
    expect(retried.commandId).toBe("cmd-1");
    expect(retried.state).toBe("processing");
    expect(canRetryPrint(failed)).toBe(true);
  });

  it("never retries a rejected submit or duplicate command", () => {
    for (const failure of ["rejected", "duplicate-submit"] as const) {
      const state = transitionPrint(createPrintRecovery("j", "c", "submit"), { type: "failed", failure });
      expect(canRetryPrint(state)).toBe(false);
      expect(retryPrint(state)).toBeNull();
    }
  });

  it("persists and restores after reload, ignoring malformed data", () => {
    const state = createPrintRecovery("j", "c", "slice");
    savePrintRecovery(state);
    expect(loadPrintRecovery()).toMatchObject(state);
    localStorage.setItem(PRINT_RECOVERY_STORAGE_KEY, "{bad");
    expect(loadPrintRecovery()).toBeNull();
    clearPrintRecovery();
    expect(loadPrintRecovery()).toBeNull();
  });
});
