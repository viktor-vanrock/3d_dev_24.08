import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_RUN_JOB_CONTRACT_VERSION,
  GENERATION_JOB_CONTRACT_VERSION,
  isAssistantRunJobPayload,
  isAssistantRunJobResult,
  isGenerationJobRow,
} from "./giga.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/giga.v1.json"), "utf8"));

describe("assistant-run.v1", () => {
  it("accepts the payload fixture", () => {
    expect(isAssistantRunJobPayload(fixture.assistant_run.payload)).toBe(true);
    expect(fixture.assistant_run.payload.contract_version).toBe(ASSISTANT_RUN_JOB_CONTRACT_VERSION);
  });

  it.each(["result_answer", "result_generation_offer", "result_error"])("accepts the %s fixture", (key) => {
    expect(isAssistantRunJobResult(fixture.assistant_run[key])).toBe(true);
  });

  it("rejects a payload with an unknown contract_version", () => {
    expect(isAssistantRunJobPayload({ ...fixture.assistant_run.payload, contract_version: "assistant-run.v0" })).toBe(
      false,
    );
  });

  it("rejects a payload missing account_id", () => {
    const { account_id: _removed, ...incomplete } = fixture.assistant_run.payload;
    expect(isAssistantRunJobPayload(incomplete)).toBe(false);
  });

  it("rejects a result whose result_type disagrees with result.kind", () => {
    expect(
      isAssistantRunJobResult({ ...fixture.assistant_run.result_answer, result_type: "clarification" }),
    ).toBe(false);
  });

  it("rejects a result_type outside giga.assistant-run.v1's produced subset", () => {
    expect(
      isAssistantRunJobResult({
        ...fixture.assistant_run.result_answer,
        result_type: "search_results",
        result: { kind: "search_results", query: "x", items: [] },
      }),
    ).toBe(false);
  });
});

describe("generation.v2", () => {
  it.each(["queued", "done_direct", "error", "running_with_progress"])("accepts the %s fixture", (key) => {
    expect(isGenerationJobRow(fixture.generation[key])).toBe(true);
    expect(fixture.generation[key].contract_version).toBe(GENERATION_JOB_CONTRACT_VERSION);
  });

  it("carries the same RunProgressSnapshot shape as AssistantRun.progress (MF-1999 amendment)", () => {
    expect(fixture.generation.running_with_progress.progress).toEqual({
      phase: "geometry",
      progress: 55,
      eta_seconds: 18,
      estimate_updated_at: "2026-07-20T12:00:20Z",
    });
  });

  it("leaves progress absent for rows not going through a generation pipeline yet", () => {
    expect(fixture.generation.queued.progress).toBeUndefined();
  });

  it("rejects a row with a malformed progress snapshot", () => {
    expect(
      isGenerationJobRow({
        ...fixture.generation.running_with_progress,
        progress: { ...fixture.generation.running_with_progress.progress, phase: "made_up" },
      }),
    ).toBe(false);
  });

  it("keeps assistant_offer_id null for a direct (non-assistant) generation", () => {
    expect(fixture.generation.done_direct.assistant_offer_id).toBeNull();
  });

  it("threads assistant_offer_id through for an assistant-confirmed generation", () => {
    expect(fixture.generation.queued.assistant_offer_id).toBe(fixture.assistant_run.payload.run_id);
  });

  it("rejects a row missing contract_version", () => {
    const { contract_version: _removed, ...incomplete } = fixture.generation.queued;
    expect(isGenerationJobRow(incomplete)).toBe(false);
  });

  it("rejects a row with an unknown status", () => {
    expect(isGenerationJobRow({ ...fixture.generation.queued, status: "made_up" })).toBe(false);
  });
});
