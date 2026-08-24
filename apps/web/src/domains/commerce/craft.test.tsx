import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CraftBadge, craftMeta, isCraftBadgeVisible } from "./craft.tsx";

afterEach(() => cleanup());

// Инвариант §2.1: бейдж скрыт при моно-ремесле — источник данных, а не ручной флаг.
describe("isCraftBadgeVisible", () => {
  it("is hidden for the mono-craft default and for empty craft", () => {
    expect(isCraftBadgeVisible("3d_printing")).toBe(false);
    expect(isCraftBadgeVisible(null)).toBe(false);
    expect(isCraftBadgeVisible(undefined)).toBe(false);
    expect(isCraftBadgeVisible("")).toBe(false);
  });

  it("is visible for any non-print craft, known or unknown", () => {
    expect(isCraftBadgeVisible("cnc")).toBe(true);
    expect(isCraftBadgeVisible("laser")).toBe(true);
    expect(isCraftBadgeVisible("totally_new_craft")).toBe(true);
  });
});

describe("craftMeta", () => {
  it("resolves known slugs to RU labels", () => {
    expect(craftMeta("cnc").label).toBe("ЧПУ");
    expect(craftMeta("software").label).toBe("Код");
  });

  it("degrades an unknown slug to the slug itself (signal to add a label, not a crash)", () => {
    expect(craftMeta("plasma_cutting").label).toBe("plasma_cutting");
  });
});

describe("CraftBadge", () => {
  it("renders nothing on the mono-craft default (dormant on MVP-print)", () => {
    const { container } = render(<CraftBadge craft="3d_printing" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders glyph + label for a non-print craft", () => {
    render(<CraftBadge craft="cnc" />);
    expect(screen.getByText("ЧПУ")).toBeTruthy();
  });

  it("compact mode hides the visible label but keeps the accessible name", () => {
    render(<CraftBadge craft="cnc" compact />);
    expect(screen.queryByText("ЧПУ")).toBeNull();
    expect(screen.getByLabelText("Ремесло: ЧПУ")).toBeTruthy();
  });
});
