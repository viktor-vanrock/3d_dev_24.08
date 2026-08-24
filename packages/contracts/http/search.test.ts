import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODEL_SEARCH_CONTRACT_VERSION,
  MODEL_SEARCH_MODES,
  isModelSearchMode,
  isModelSearchResponseFields,
} from "./search.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/model-search.v1.json"), "utf8"));

describe("model-search.v1", () => {
  it.each(["hybrid", "lexical_degraded", "empty"] as const)(
    "accepts the %s GET /models response_fields shape",
    (scenario) => {
      expect(isModelSearchResponseFields(fixture[scenario].response_fields)).toBe(true);
      expect(fixture[scenario].response_fields.contract_version).toBe(MODEL_SEARCH_CONTRACT_VERSION);
    },
  );

  it("marks degraded only on the lexical fallback scenario", () => {
    expect(fixture.hybrid.response_fields.degraded).toBeUndefined();
    expect(fixture.empty.response_fields.degraded).toBeUndefined();
    expect(fixture.lexical_degraded.response_fields.degraded).toBe(true);
    expect(fixture.lexical_degraded.response_fields.search_mode_used).toBe("lexical");
  });

  it("keeps meta present even for a zero-result query (empty is not an error)", () => {
    expect(fixture.empty.models_count_example).toBe(0);
    expect(isModelSearchResponseFields(fixture.empty.response_fields)).toBe(true);
  });

  it("validates search_mode against the closed hybrid|lexical set", () => {
    for (const mode of MODEL_SEARCH_MODES) expect(isModelSearchMode(mode)).toBe(true);
    expect(isModelSearchMode("semantic")).toBe(false);
    expect(isModelSearchMode(undefined)).toBe(false);
  });

  it("rejects an unsupported contract_version", () => {
    expect(isModelSearchResponseFields(fixture.invalid_examples.unsupported_contract_version)).toBe(false);
  });

  it("rejects degraded:false (only true or absent is valid)", () => {
    expect(isModelSearchResponseFields(fixture.invalid_examples.degraded_false_rejected)).toBe(false);
  });

  it("rejects an unknown search_mode_used", () => {
    expect(isModelSearchResponseFields(fixture.invalid_examples.unknown_search_mode)).toBe(false);
  });

  it("rejects a response missing request_id", () => {
    const { request_id: _removed, ...incomplete } = fixture.hybrid.response_fields;
    expect(isModelSearchResponseFields(incomplete)).toBe(false);
  });

  it("never leaks raw score or embedding model name in the response fields", () => {
    for (const scenario of ["hybrid", "lexical_degraded", "empty"] as const) {
      const serialized = JSON.stringify(fixture[scenario].response_fields);
      expect(serialized).not.toMatch(/score|embedding|GigaEmbeddings/i);
    }
  });
});
