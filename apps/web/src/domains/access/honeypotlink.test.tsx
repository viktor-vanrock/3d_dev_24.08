import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { HoneypotLink } from "./honeypotlink.tsx";

afterEach(() => {
  cleanup();
});

// MF-737: ссылка-приманка должна остаться настоящим кликабельным <a href>, но быть
// невидимой/недостижимой для живого посетителя — иначе либо бот её не найдёт (нет href),
// либо человек может случайно на неё попасть (нет aria-hidden/tabIndex/CSS-скрытия).
describe("HoneypotLink", () => {
  it("renders a real <a href> pointing at the honeypot API path", () => {
    const { container } = render(<HoneypotLink />);
    const link = container.querySelector("a.honeypotLink");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toContain("/models/_index/scan");
  });

  it("is hidden from assistive tech and removed from keyboard tab order", () => {
    const { container } = render(<HoneypotLink />);
    const link = container.querySelector("a.honeypotLink");
    expect(link?.getAttribute("aria-hidden")).toBe("true");
    expect(link?.getAttribute("tabindex")).toBe("-1");
    expect(link?.getAttribute("rel")).toBe("nofollow");
  });
});
