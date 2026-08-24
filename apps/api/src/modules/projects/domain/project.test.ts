import { describe, expect, it } from "vitest";
import { canonicalJson, decodeCursor, encodeCursor, normalizeTags, sha256Canonical } from "./project.ts";
import { parseIdempotencyKey, parseIfMatch, projectEtag, ProjectError } from "./project.errors.ts";

describe("Project API v1 domain primitives", () => {
  it("parses only a strong quoted positive Project version", () => {
    expect(parseIfMatch('"12"')).toBe(12);
    expect(projectEtag(12)).toBe('"12"');
    for (const value of [undefined, "12", 'W/"12"', '"0"', '"1", "2"']) {
      expect(() => parseIfMatch(value)).toThrow(ProjectError);
    }
  });

  it("accepts printable scoped idempotency keys only", () => {
    expect(parseIdempotencyKey("retry-1")).toBe("retry-1");
    expect(() => parseIdempotencyKey(undefined)).toThrow(ProjectError);
    expect(() => parseIdempotencyKey("\n")).toThrow(ProjectError);
    expect(() => parseIdempotencyKey("x".repeat(129))).toThrow(ProjectError);
  });

  it("canonicalizes publication input independent of object insertion order", () => {
    expect(canonicalJson({ b: 2, a: [{ d: 4, c: 3 }] })).toBe('{"a":[{"c":3,"d":4}],"b":2}');
    expect(sha256Canonical({ b: 2, a: 1 })).toEqual(sha256Canonical({ a: 1, b: 2 }));
    expect(sha256Canonical({ models: ["a", "b"] })).not.toEqual(sha256Canonical({ models: ["b", "a"] }));
  });

  it("signs cursors and rejects tampering", () => {
    const value = encodeCursor(["2026-08-10T00:00:00.000Z", "00000000-0000-4000-8000-000000000001"]);
    expect(decodeCursor(value, 2)).toEqual(["2026-08-10T00:00:00.000Z", "00000000-0000-4000-8000-000000000001"]);
    expect(decodeCursor(`${value}x`, 2)).toBeNull();
    expect(decodeCursor(value, 3)).toBeNull();
  });

  it("normalizes and deterministically orders unique tags", () => {
    expect(normalizeTags([" Beta ", "alpha", "beta"])).toEqual(["alpha", "beta"]);
  });
});
