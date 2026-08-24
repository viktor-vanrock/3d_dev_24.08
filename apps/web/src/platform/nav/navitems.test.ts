import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./navitems.ts";

describe("NAV_ITEMS — глобальная навигация", () => {
  it("содержит пять канонических разделов в продуктовом порядке и не содержит Идеи", () => {
    expect(NAV_ITEMS).toEqual([
      { section: "home", label: "Дом" },
      { section: "feed", label: "Новости" },
      { section: "market", label: "Проекты" },
      { section: "printers", label: "Принтеры" },
      { section: "materials", label: "Материалы" },
    ]);
    expect(NAV_ITEMS.map((item) => item.section)).not.toContain("issue");
    expect(NAV_ITEMS.map((item) => item.label)).not.toContain("Идеи");
  });
});
