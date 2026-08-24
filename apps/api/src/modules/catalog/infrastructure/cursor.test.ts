import { describe, expect, it } from "vitest";
import { CatalogCursorError, decodePrinterCatalogCursor, encodePrinterCatalogCursor } from "./cursor.ts";

const SECRET = "catalog-cursor-test-secret";
const FINGERPRINT = "a".repeat(64);

describe("printer catalog opaque cursor", () => {
  it("signs a cursor, keeps it opaque, and preserves null position values", () => {
    const cursor = encodePrinterCatalogCursor({
      fingerprint: FINGERPRINT,
      position: [null, "2026-07-15", "00000000-0000-0000-0000-000000000001"],
      secret: SECRET,
      now: 1_000,
      ttlSeconds: 60,
    });

    expect(cursor).not.toContain(FINGERPRINT);
    expect(cursor).not.toContain("2026-07-15");
    expect(decodePrinterCatalogCursor(cursor, { fingerprint: FINGERPRINT, secret: SECRET, now: 1_010 })).toEqual({
      position: [null, "2026-07-15", "00000000-0000-0000-0000-000000000001"],
      expiresAt: 1_060,
    });
  });

  it.each([
    ["query mismatch", { fingerprint: "b".repeat(64), secret: SECRET, now: 1_010 }],
    ["foreign secret", { fingerprint: FINGERPRINT, secret: "other-secret", now: 1_010 }],
    ["expired", { fingerprint: FINGERPRINT, secret: SECRET, now: 1_060 }],
  ] as const)("rejects %s as invalid_cursor", (_reason, options) => {
    const cursor = encodePrinterCatalogCursor({ fingerprint: FINGERPRINT, position: ["id"], secret: SECRET, now: 1_000, ttlSeconds: 60 });

    expect(() => decodePrinterCatalogCursor(cursor, options)).toThrowError(CatalogCursorError);
    try {
      decodePrinterCatalogCursor(cursor, options);
    } catch (error) {
      expect((error as CatalogCursorError).code).toBe("invalid_cursor");
    }
  });

  it("rejects tampering and malformed opaque values", () => {
    const cursor = encodePrinterCatalogCursor({ fingerprint: FINGERPRINT, position: ["id"], secret: SECRET });
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;

    expect(() => decodePrinterCatalogCursor(tampered, { fingerprint: FINGERPRINT, secret: SECRET })).toThrowError(CatalogCursorError);
    expect(() => decodePrinterCatalogCursor("not-a-cursor", { fingerprint: FINGERPRINT, secret: SECRET })).toThrowError(CatalogCursorError);
  });
});
