import { describe, expect, it } from "vitest";
import { MANIFEST_ERROR_CODE, MANIFEST_ERROR_MESSAGE, ManifestDiagnosticError } from "./diagnostics.ts";

describe("MANIFEST_ERROR_CODE taxonomy", () => {
  it("has exactly one human-readable message per code — no code silently falls back to a generic message", () => {
    const codes = Object.values(MANIFEST_ERROR_CODE).sort();
    const messageKeys = Object.keys(MANIFEST_ERROR_MESSAGE).sort();
    expect(messageKeys).toEqual(codes);
  });

  it("every message is non-empty", () => {
    for (const message of Object.values(MANIFEST_ERROR_MESSAGE)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("ManifestDiagnosticError carries the code and an optional path", () => {
    const err = new ManifestDiagnosticError(MANIFEST_ERROR_CODE.MANIFEST_DANGLING_REF, "boom", "$.foo");
    expect(err.code).toBe("MANIFEST_DANGLING_REF");
    expect(err.message).toContain("boom");
    expect(err.message).toContain("$.foo");
    expect(err.path).toBe("$.foo");
  });
});
