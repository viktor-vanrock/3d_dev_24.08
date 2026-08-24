import { describe, expect, it } from "vitest";
import negative from "./fixtures/negative.json" with { type: "json" };
import { isCommandVerificationKeySet, isTransferSpoolStateV1, parsePersistedJson } from "./index.ts";

describe("device-agent-runtime.v1 negative fixtures", () => {
  it.each(negative.cases)("rejects $name", ({ kind, value }) => {
    expect(kind === "keys" ? isCommandVerificationKeySet(value) : isTransferSpoolStateV1(value)).toBe(false);
  });

  it("rejects malformed persisted JSON before validation", () => {
    expect(parsePersistedJson(negative.invalid_persisted_json)).toBeNull();
  });
});
