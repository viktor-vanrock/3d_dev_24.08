import { describe, expect, it } from "vitest";
import { printerConflictValue } from "./printers.service.ts";

describe("printerConflictValue", () => {
  it("сериализует released_at из PostgreSQL как календарную дату", () => {
    const releasedAt = new Date(2026, 8, 17);
    expect(printerConflictValue("released_at", releasedAt)).toBe("2026-09-17");
  });

  it("сохраняет JSON-форму сложных conflict values", () => {
    expect(printerConflictValue("aliases", ["MK4", "MK4S"])).toEqual(["MK4", "MK4S"]);
    expect(printerConflictValue("media", { hero: "printer.webp" })).toEqual({ hero: "printer.webp" });
  });
});
