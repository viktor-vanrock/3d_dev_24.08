import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentComposer } from "./commenttree.tsx";

afterEach(cleanup);

describe("CommentComposer", () => {
  it("представляет поле как ответ текущего пользователя", () => {
    const { container } = render(
      <CommentComposer
        user={{ id: "u1", username: "maker", display_name: "Мейкер", avatar_url: null, handle_confirmed: true, role: "user" }}
        onSubmit={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByText("@maker")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Комментарий" })).toBeTruthy();
    expect(container.querySelector(".feedCommentComposerIdentity svg")).toBeTruthy();
    expect(container.querySelector(".feedCommentComposerIdentity img")).toBeNull();
  });
});
