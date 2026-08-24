import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_RESULT_KINDS,
  RUN_PHASES,
  isAssistantRunResult,
  isConfirmAssistantGenerationRequest,
  isCreateAssistantMessageRequest,
  isRunProgressSnapshot,
} from "./assistant.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/assistant.v1.json"), "utf8"));

describe("assistant.v1 result union", () => {
  it.each(ASSISTANT_RESULT_KINDS)("accepts the %s fixture", (kind) => {
    expect(isAssistantRunResult(fixture[kind])).toBe(true);
    expect(fixture[kind].kind).toBe(kind);
  });

  it("rejects a result with an unknown kind", () => {
    expect(isAssistantRunResult({ ...fixture.answer, kind: "made_up" })).toBe(false);
  });

  it("rejects an answer missing text", () => {
    const { text: _removed, ...incomplete } = fixture.answer;
    expect(isAssistantRunResult(incomplete)).toBe(false);
  });

  it("rejects a clarification with an empty question", () => {
    expect(isAssistantRunResult({ ...fixture.clarification, question: "" })).toBe(false);
  });

  it("rejects a generation_offer missing offer_id", () => {
    const { offer_id: _removed, ...incomplete } = fixture.generation_offer;
    expect(isAssistantRunResult(incomplete)).toBe(false);
  });

  it("rejects a generation_offer with oversized params (not an object)", () => {
    expect(isAssistantRunResult({ ...fixture.generation_offer, params: "not-an-object" })).toBe(false);
  });

  it("rejects a generation_progress missing generation_id", () => {
    const { generation_id: _removed, ...incomplete } = fixture.generation_progress;
    expect(isAssistantRunResult(incomplete)).toBe(false);
  });

  it("rejects an error with an unknown code", () => {
    expect(isAssistantRunResult({ ...fixture.error, code: "made_up" })).toBe(false);
  });

  it("documents the idempotency-conflict response shape", () => {
    expect(fixture.idempotency_conflict.status).toBe(409);
    expect(fixture.idempotency_conflict.body.error).toBe("assistant_idempotency_conflict");
  });
});

describe("run progress snapshot (MF-1999 amendment)", () => {
  it.each(RUN_PHASES)("accepts the %s phase fixture", (phase) => {
    expect(isRunProgressSnapshot(fixture.run_progress[phase])).toBe(true);
    expect(fixture.run_progress[phase].phase).toBe(phase);
  });

  it("queued phase has no meaningful percent (progress: null)", () => {
    expect(fixture.run_progress.queued.progress).toBeNull();
  });

  it("non-queued phases carry a numeric progress, not an interpolated guess", () => {
    for (const phase of RUN_PHASES.filter((p) => p !== "queued")) {
      expect(typeof fixture.run_progress[phase].progress).toBe("number");
    }
  });

  it("rejects an unknown phase", () => {
    expect(isRunProgressSnapshot({ ...fixture.run_progress.draft, phase: "made_up" })).toBe(false);
  });

  it("rejects a snapshot missing estimate_updated_at", () => {
    const { estimate_updated_at: _removed, ...incomplete } = fixture.run_progress.draft;
    expect(isRunProgressSnapshot(incomplete)).toBe(false);
  });

  it("a run mid-generation carries a progress snapshot", () => {
    expect(fixture.run_with_progress.status).toBe("running");
    expect(isRunProgressSnapshot(fixture.run_with_progress.progress)).toBe(true);
  });

  it("a clarify/answer run has no progress (null, not fabricated)", () => {
    expect(fixture.run_without_progress.status).toBe("done");
    expect(fixture.run_without_progress.progress).toBeNull();
  });
});

describe("request guards", () => {
  it("accepts a well-formed create-message request", () => {
    expect(isCreateAssistantMessageRequest({ content: "сделай куб", client_request_id: "req-1" })).toBe(true);
  });

  it("rejects a create-message request without client_request_id", () => {
    expect(isCreateAssistantMessageRequest({ content: "сделай куб" })).toBe(false);
  });

  it("accepts a well-formed confirm-generation request", () => {
    expect(isConfirmAssistantGenerationRequest({ run_id: "9c1f2e10-1111-4a11-8a11-000000000001" })).toBe(true);
  });

  it("rejects a confirm-generation request without run_id", () => {
    expect(isConfirmAssistantGenerationRequest({})).toBe(false);
  });
});
