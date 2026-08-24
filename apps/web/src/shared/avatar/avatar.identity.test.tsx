import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_AVATAR, UserAvatar } from "./avatar.tsx";

afterEach(cleanup);

describe("UserAvatar", () => {
  it("shows the canonical portrait when it is available", () => {
    render(
      <UserAvatar
        config={DEFAULT_AVATAR}
        snapshots={{ front: "/portrait.png", left: null, right: null }}
        size={36}
        label="Персонаж @maker"
      />,
    );

    expect(screen.getByRole("img", { name: "Персонаж @maker" }).getAttribute("src")).toBe("/portrait.png");
  });

  it("shows the default mascot instead of a photo or letter when configuration is absent", () => {
    render(<UserAvatar config={null} snapshots={null} size={36} label="Персонаж @newmaker" />);

    expect(screen.getByRole("img", { name: "Персонаж @newmaker" }).tagName).toBe("svg");
  });
});
