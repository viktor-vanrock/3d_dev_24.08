import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROMPT_VARIANTS_CONTRACT_VERSION,
  PROMPT_VARIANTS_CONTEXTS,
  isPromptVariantsContext,
  isPromptVariantsRequest,
  isPromptVariantsResponse,
} from "./prompt-variants.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/prompt-variants.v1.json"), "utf8"));

describe("assistant.prompt-variants.v1", () => {
  it("accepts the success fixture", () => {
    expect(isPromptVariantsResponse(fixture.success)).toBe(true);
    expect(fixture.success.contract_version).toBe(PROMPT_VARIANTS_CONTRACT_VERSION);
    expect(fixture.success.degraded).toBeUndefined();
  });

  it("accepts the degraded fixture", () => {
    expect(isPromptVariantsResponse(fixture.degraded)).toBe(true);
    expect(fixture.degraded.degraded).toBe(true);
    expect(fixture.degraded.variants).toHaveLength(1);
  });

  it("rejects an unsupported contract_version", () => {
    expect(isPromptVariantsResponse(fixture.invalid_examples.unsupported_contract_version)).toBe(false);
  });

  it("rejects degraded:false (only true or absent is valid)", () => {
    expect(isPromptVariantsResponse(fixture.invalid_examples.degraded_false_rejected)).toBe(false);
  });

  it("rejects a response missing request_id", () => {
    const { request_id: _removed, ...incomplete } = fixture.success;
    expect(isPromptVariantsResponse(incomplete)).toBe(false);
  });

  it("rejects a variant missing prompt", () => {
    const [first, ...rest] = fixture.success.variants;
    const { prompt: _removed, ...incompleteVariant } = first;
    expect(isPromptVariantsResponse({ ...fixture.success, variants: [incompleteVariant, ...rest] })).toBe(false);
  });

  it("validates context against the closed set", () => {
    for (const context of PROMPT_VARIANTS_CONTEXTS) expect(isPromptVariantsContext(context)).toBe(true);
    expect(isPromptVariantsContext("profile")).toBe(false);
    expect(isPromptVariantsContext(undefined)).toBe(false);
  });

  it("accepts a minimal request with only query", () => {
    expect(isPromptVariantsRequest({ query: "дракон" })).toBe(true);
    expect(
      isPromptVariantsRequest({
        query: "дракон",
        batch: 12,
        exclude_labels: ["Дракон-брелок", "Дракон-светильник"],
      }),
    ).toBe(true);
  });

  it("rejects a request with an empty query", () => {
    expect(isPromptVariantsRequest({ query: "" })).toBe(false);
    expect(isPromptVariantsRequest({ query: "   " })).toBe(false);
  });

  it("rejects a request with an unknown context", () => {
    expect(isPromptVariantsRequest({ query: "дракон", context: "profile" })).toBe(false);
  });

  it("rejects malformed infinite-feed continuation fields", () => {
    expect(isPromptVariantsRequest({ query: "дракон", batch: -1 })).toBe(false);
    expect(isPromptVariantsRequest({ query: "дракон", batch: 1.5 })).toBe(false);
    expect(isPromptVariantsRequest({ query: "дракон", exclude_labels: [""] })).toBe(false);
    expect(isPromptVariantsRequest({ query: "дракон", exclude_labels: ["x".repeat(81)] })).toBe(false);
  });

  it("never leaks a raw s3 key or internal score field in the response fixtures", () => {
    for (const scenario of ["success", "degraded"] as const) {
      const serialized = JSON.stringify(fixture[scenario]);
      expect(serialized).not.toMatch(/s3_key|embedding/i);
    }
  });
});
