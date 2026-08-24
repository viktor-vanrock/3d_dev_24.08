import { describe, expect, it } from "vitest";
import { matchCandidate } from "./match.ts";

describe("matchCandidate", () => {
  it("matches exactly on a normalized alias — this is the RU/EN dedup path", () => {
    const block = [{ id: "m1", model: "SV06 Plus", aliases: ["СВ06 Плюс"] }];
    const result = matchCandidate("СВ06 Плюс", block);
    expect(result).toEqual({ machineId: "m1", score: 1, confidence: "high" });
  });

  it("matches exactly on the model itself, case/punctuation-insensitive", () => {
    const block = [{ id: "m1", model: "SV06 Plus", aliases: [] }];
    expect(matchCandidate("sv-06 plus!", block)).toEqual({ machineId: "m1", score: 1, confidence: "high" });
  });

  it("classifies a close typo'd match as high confidence via trigram similarity", () => {
    const block = [{ id: "m1", model: "SV06 Plus", aliases: [] }];
    const result = matchCandidate("SV06Plus", block);
    expect(result?.machineId).toBe("m1");
    expect(result?.confidence).toBe("high");
  });

  it("flags a different-but-related model as ambiguous instead of auto-merging (V2 vs V2 Neo)", () => {
    const block = [{ id: "m1", model: "Ender 3 V2", aliases: [] }];
    const result = matchCandidate("Ender 3 V2 Neo", block);
    expect(result).not.toBeNull();
    expect(result?.confidence).toBe("ambiguous");
  });

  it("flags a different version of the same line as ambiguous, not a match (V2 vs V3)", () => {
    const block = [{ id: "m1", model: "Ender 3 V2", aliases: [] }];
    const result = matchCandidate("Ender 3 V3", block);
    expect(result).not.toBeNull();
    expect(result?.confidence).toBe("ambiguous");
  });

  it("returns null when nothing in the block is even remotely similar", () => {
    const block = [{ id: "m1", model: "Ender 3 V2", aliases: [] }];
    expect(matchCandidate("Bambu Lab X1 Carbon", block)).toBeNull();
  });

  it("returns null for an empty block (no existing machines for this vendor)", () => {
    expect(matchCandidate("SV06 Plus", [])).toBeNull();
  });

  it("picks the best-scoring machine among several in the block", () => {
    const block = [
      { id: "m1", model: "Ender 3", aliases: [] },
      { id: "m2", model: "Ender 3 V2", aliases: [] },
      { id: "m3", model: "Ender 3 V3", aliases: [] },
    ];
    const result = matchCandidate("Ender 3 V2", block);
    expect(result?.machineId).toBe("m2");
    expect(result?.score).toBe(1);
  });
});
