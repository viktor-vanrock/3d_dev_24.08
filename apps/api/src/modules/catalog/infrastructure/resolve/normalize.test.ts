import { describe, expect, it } from "vitest";
import { compactModelName, normalizeModelName } from "./normalize.ts";

describe("normalizeModelName", () => {
  it("lowercases and collapses punctuation/whitespace", () => {
    expect(normalizeModelName("SV06 Plus")).toBe("sv06 plus");
    expect(normalizeModelName("SV-06  Plus!")).toBe("sv 06 plus");
    expect(normalizeModelName("sv06plus")).toBe("sv06plus");
  });

  it("normalizes ё to е", () => {
    expect(normalizeModelName("Ёж3D")).toBe("еж3d");
  });

  it("keeps non-latin scripts as-is (no transliteration)", () => {
    expect(normalizeModelName("Печатник СВ06 Плюс")).toBe("печатник св06 плюс");
  });
});

describe("compactModelName", () => {
  it("unifies hyphen/space/no-separator spellings of the same model", () => {
    expect(compactModelName("SV-06 Plus")).toBe("sv06plus");
    expect(compactModelName("SV06 Plus")).toBe("sv06plus");
    expect(compactModelName("SV06Plus")).toBe("sv06plus");
  });
});
